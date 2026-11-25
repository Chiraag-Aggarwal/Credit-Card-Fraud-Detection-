"""PostgreSQL domain repository. Every operation owns a short-lived transaction.

SQLite is available only with an explicit test opt-in. Public records retain the
API's camelCase names; IDs are opaque strings, including imported MongoDB IDs.
"""

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any
import uuid

from sqlalchemy import (
    JSON, BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey,
    Index, Integer, Numeric, String, Text, case, create_engine, event, func,
    inspect, select, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import TypeDecorator


SCHEMA_REVISION = "0002_legacy_payment_ids"
RISK_LABELS = ("LOW", "MEDIUM", "HIGH", "UNSCORED")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    # Old exports may contain naive Mongo datetimes, which represent UTC.
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class UTCDateTime(TypeDecorator):
    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return as_utc(value) if value is not None else None

    def process_result_value(self, value, dialect):
        return as_utc(value) if value is not None else None


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="ck_users_email_lowercase"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(32), default="merchant")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("display_amount >= 0", name="ck_transactions_amount"),
        CheckConstraint("fraud_probability IS NULL OR (fraud_probability >= 0 AND fraud_probability <= 1)", name="ck_transactions_probability"),
        CheckConstraint("risk_label IN ('LOW','MEDIUM','HIGH','UNSCORED')", name="ck_transactions_risk"),
        CheckConstraint("scoring_status IN ('scored','pending_review')", name="ck_transactions_scoring"),
        CheckConstraint("review_decision IS NULL OR review_decision IN ('confirmed_fraud','legit')", name="ck_transactions_review"),
        Index("ix_transactions_merchant_created", "merchant_id", "created_at"),
        Index("ix_transactions_merchant_scoring", "merchant_id", "scoring_status"),
        Index("ix_transactions_merchant_flagged_review", "merchant_id", "is_flagged", "review_decision"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    display_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3))
    source: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(32))
    features: Mapped[dict] = mapped_column(JSON().with_variant(JSONB(), "postgresql"))
    ground_truth_label: Mapped[int | None] = mapped_column(Integer)
    fraud_probability: Mapped[float | None] = mapped_column(Float)
    risk_label: Mapped[str] = mapped_column(String(16))
    is_flagged: Mapped[bool] = mapped_column(Boolean)
    scoring_status: Mapped[str] = mapped_column(String(32))
    scoring_reason: Mapped[str | None] = mapped_column(Text)
    model_version: Mapped[str] = mapped_column(String(200), default="")
    review_decision: Mapped[str | None] = mapped_column(String(32))
    reviewed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    stripe_event_id: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    razorpay_order_id: Mapped[str | None] = mapped_column(String(255), index=True)
    razorpay_event_id: Mapped[str | None] = mapped_column(String(255))
    payment_mode: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class PaymentCheckout(Base):
    __tablename__ = "payment_checkouts"
    __table_args__ = (
        CheckConstraint("amount_paise > 0", name="ck_payment_checkouts_amount"),
        Index("ix_payment_checkouts_merchant_created", "merchant_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    razorpay_order_id: Mapped[str] = mapped_column(String(255), unique=True)
    merchant_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    amount_paise: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(String(3))
    mode: Mapped[str] = mapped_column(String(32))
    payment_mode: Mapped[str | None] = mapped_column(String(16))
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)


class WebhookEvent(Base):
    __tablename__ = "webhook_events"
    __table_args__ = (CheckConstraint("status IN ('received','completed')", name="ck_webhook_events_status"),)

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(120))
    payload_digest: Mapped[str] = mapped_column(String(64))
    payment_id: Mapped[str | None] = mapped_column(String(255), index=True)
    transaction_id: Mapped[str | None] = mapped_column(ForeignKey("transactions.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(String(16), index=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utc_now)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class DuplicateRecordError(Exception):
    """An immutable ID, email, order, or payment already exists."""


def database_engine(database_url: str, *, allow_sqlite: bool = False):
    if not database_url or not database_url.strip():
        raise ValueError("DATABASE_URL must be configured.")
    try:
        url = make_url(database_url.strip())
    except Exception:
        raise ValueError("DATABASE_URL is not a valid database URL.") from None
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    backend = url.get_backend_name()
    if backend != "postgresql" and not (backend == "sqlite" and allow_sqlite):
        raise ValueError("DATABASE_URL must use PostgreSQL. SQLite requires an explicit test opt-in.")
    options: dict[str, Any] = {"pool_pre_ping": True, "hide_parameters": True}
    if backend == "sqlite":
        options["connect_args"] = {"check_same_thread": False}
        if url.database in {None, "", ":memory:"}:
            options["poolclass"] = StaticPool
    else:
        options.update(pool_size=5, max_overflow=5, pool_recycle=1800)
        options["connect_args"] = {"connect_timeout": 10}
    engine = create_engine(url, **options)
    if backend == "sqlite":
        @event.listens_for(engine, "connect")
        def enable_foreign_keys(connection, _record):
            connection.execute("PRAGMA foreign_keys=ON")
    return engine


def record_id(data: dict) -> str:
    return str(data.get("_id") or data.get("id") or uuid.uuid4().hex)


def user_record(row: User) -> dict:
    return {"_id": row.id, "name": row.name, "email": row.email, "passwordHash": row.password_hash,
            "role": row.role, "createdAt": row.created_at}


TRANSACTION_FIELDS = {
    "merchantId": "merchant_id", "displayAmount": "display_amount", "currency": "currency", "source": "source",
    "status": "status", "features": "features", "groundTruthLabel": "ground_truth_label",
    "fraudProbability": "fraud_probability", "riskLabel": "risk_label", "isFlagged": "is_flagged",
    "scoringStatus": "scoring_status", "scoringReason": "scoring_reason", "modelVersion": "model_version",
    "reviewDecision": "review_decision", "reviewedAt": "reviewed_at", "reviewedBy": "reviewed_by",
    "stripePaymentIntentId": "stripe_payment_intent_id", "stripeEventId": "stripe_event_id", "razorpayPaymentId": "razorpay_payment_id",
    "razorpayOrderId": "razorpay_order_id", "razorpayEventId": "razorpay_event_id",
    "paymentMode": "payment_mode", "createdAt": "created_at",
}


def transaction_record(row: Transaction) -> dict:
    return {"_id": row.id, **{key: getattr(row, attr) for key, attr in TRANSACTION_FIELDS.items()}}


def checkout_record(row: PaymentCheckout) -> dict:
    return {"_id": row.id, "razorpayOrderId": row.razorpay_order_id, "merchantId": row.merchant_id,
            "amountPaise": row.amount_paise, "currency": row.currency, "mode": row.mode,
            "paymentMode": row.payment_mode, "expiresAt": row.expires_at, "createdAt": row.created_at}


def webhook_record(row: WebhookEvent) -> dict:
    return {"_id": row.id, "eventType": row.event_type, "payloadDigest": row.payload_digest,
            "paymentId": row.payment_id, "transactionId": row.transaction_id, "status": row.status,
            "receivedAt": row.received_at, "completedAt": row.completed_at}


class Repository:
    def __init__(self, database_url: str, *, allow_sqlite: bool = False):
        self.engine = database_engine(database_url, allow_sqlite=allow_sqlite)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    @contextmanager
    def _session(self):
        try:
            with self.sessions.begin() as session:
                yield session
        except IntegrityError as error:
            code = getattr(error.orig, "sqlstate", None)
            sqlite_code = getattr(error.orig, "sqlite_errorname", "")
            if code == "23505" or sqlite_code in {"SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"}:
                raise DuplicateRecordError("A unique record already exists.") from None
            raise

    def ping(self) -> bool:
        with self.engine.connect() as connection:
            return connection.execute(text("SELECT 1")).scalar_one() == 1

    def close(self) -> None:
        self.engine.dispose()

    def create_schema(self) -> None:
        """Create a disposable SQLite test schema; deployed databases use Alembic."""
        if self.engine.dialect.name != "sqlite":
            raise RuntimeError("Run scripts/migrate_database.py to create the PostgreSQL schema.")
        Base.metadata.create_all(self.engine)

    def check_schema(self) -> None:
        with self.engine.connect() as connection:
            if not inspect(connection).has_table("alembic_version"):
                raise RuntimeError("Database migrations are missing. Run scripts/migrate_database.py.")
            revisions = set(connection.execute(text("SELECT version_num FROM alembic_version")).scalars())
            if revisions != {SCHEMA_REVISION}:
                raise RuntimeError("Database schema is outdated. Run scripts/migrate_database.py.")

    def create_user(self, data: dict) -> dict:
        with self._session() as session:
            row = User(id=record_id(data), name=data["name"], email=data["email"].strip().lower(),
                       password_hash=data["passwordHash"], role=data.get("role", "merchant"),
                       created_at=as_utc(data.get("createdAt") or utc_now()))
            session.add(row)
            session.flush()
            return user_record(row)

    def get_user(self, user_id: str) -> dict | None:
        with self._session() as session:
            row = session.get(User, str(user_id))
            return user_record(row) if row else None

    def get_user_by_email(self, email: str) -> dict | None:
        with self._session() as session:
            row = session.scalar(select(User).where(User.email == email.strip().lower()))
            return user_record(row) if row else None

    def update_user(self, user_id: str, *, name: str, email: str) -> dict | None:
        with self._session() as session:
            row = session.get(User, str(user_id))
            if row is None:
                return None
            row.name, row.email = name, email.strip().lower()
            session.flush()
            return user_record(row)

    def create_transaction(self, data: dict) -> dict:
        values = {attr: data[key] for key, attr in TRANSACTION_FIELDS.items() if key in data}
        values["merchant_id"] = str(data["merchantId"])
        if values.get("reviewed_by") is not None:
            values["reviewed_by"] = str(values["reviewed_by"])
        values["display_amount"] = Decimal(str(data["displayAmount"]))
        values["currency"] = data["currency"].lower()
        values.setdefault("status", "captured" if data["source"] == "razorpay" else "simulated")
        values.setdefault("features", {})
        values.setdefault("risk_label", "UNSCORED")
        values.setdefault("is_flagged", True)
        values.setdefault("scoring_status", "pending_review")
        values.setdefault("model_version", "")
        values["created_at"] = as_utc(data.get("createdAt") or utc_now())
        with self._session() as session:
            row = Transaction(id=record_id(data), **values)
            session.add(row)
            session.flush()
            session.refresh(row)
            return transaction_record(row)

    def get_transaction(self, transaction_id: str, merchant_id: str) -> dict | None:
        with self._session() as session:
            row = session.scalar(select(Transaction).where(Transaction.id == str(transaction_id), Transaction.merchant_id == str(merchant_id)))
            return transaction_record(row) if row else None

    def get_transaction_by_payment(self, payment_id: str) -> dict | None:
        with self._session() as session:
            row = session.scalar(select(Transaction).where(Transaction.razorpay_payment_id == payment_id))
            return transaction_record(row) if row else None

    def list_transactions(self, merchant_id: str, *, page: int = 1, limit: int = 20,
                          risk_label: str | None = None, flagged: bool | None = None,
                          from_date: datetime | None = None, to_date: datetime | None = None) -> tuple[list[dict], int]:
        if page < 1 or not 1 <= limit <= 100:
            raise ValueError("Invalid transaction pagination.")
        clauses = [Transaction.merchant_id == str(merchant_id)]
        if risk_label is not None:
            clauses.append(Transaction.risk_label == risk_label)
        if flagged is not None:
            clauses.append(Transaction.is_flagged == flagged)
        if from_date is not None:
            clauses.append(Transaction.created_at >= as_utc(from_date))
        if to_date is not None:
            clauses.append(Transaction.created_at <= as_utc(to_date))
        with self._session() as session:
            total = session.scalar(select(func.count()).select_from(Transaction).where(*clauses))
            rows = session.scalars(select(Transaction).where(*clauses)
                                   .order_by(Transaction.created_at.desc(), Transaction.id.desc())
                                   .offset((page - 1) * limit).limit(limit))
            return [transaction_record(row) for row in rows], int(total)

    def review_transaction(self, transaction_id: str, merchant_id: str, decision: str) -> dict | None:
        if decision not in {"confirmed_fraud", "legit"}:
            raise ValueError("Unknown review decision.")
        with self._session() as session:
            row = session.scalar(select(Transaction).where(Transaction.id == str(transaction_id), Transaction.merchant_id == str(merchant_id)).with_for_update())
            if row is None:
                return None
            row.review_decision, row.is_flagged = decision, decision == "confirmed_fraud"
            row.reviewed_at, row.reviewed_by = utc_now(), str(merchant_id)
            session.flush()
            return transaction_record(row)

    def unread_count(self, merchant_id: str) -> int:
        with self._session() as session:
            return int(session.scalar(select(func.count()).select_from(Transaction).where(
                Transaction.merchant_id == str(merchant_id), Transaction.is_flagged.is_(True), Transaction.review_decision.is_(None))))

    def _series(self, session, merchant_id: str, start: datetime, count: int, unit: str) -> list[dict]:
        step = timedelta(hours=1) if unit == "hour" else timedelta(days=1)
        if self.engine.dialect.name == "postgresql":
            bucket = func.date_trunc(unit, Transaction.created_at, "UTC")
        else:
            bucket = func.strftime("%Y-%m-%dT%H:00:00" if unit == "hour" else "%Y-%m-%dT00:00:00", Transaction.created_at)
        rows = session.execute(select(bucket.label("bucket"), func.count(), func.sum(case((Transaction.is_flagged.is_(True), 1), else_=0)))
                               .where(Transaction.merchant_id == str(merchant_id), Transaction.created_at >= start, Transaction.created_at < start + step * count)
                               .group_by(bucket))
        lookup = {}
        for timestamp, total, flagged in rows:
            timestamp = datetime.fromisoformat(timestamp) if isinstance(timestamp, str) else timestamp
            lookup[as_utc(timestamp)] = (int(total), int(flagged))
        return [{"t": (start + step * index).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                 "total": lookup.get(start + step * index, (0, 0))[0],
                 "flagged": lookup.get(start + step * index, (0, 0))[1]} for index in range(count)]

    def transaction_stats(self, merchant_id: str, *, now: datetime | None = None) -> dict:
        now = as_utc(now or utc_now())
        with self._session() as session:
            row = session.execute(select(
                func.count(), func.sum(case((Transaction.is_flagged.is_(True), 1), else_=0)), func.avg(Transaction.fraud_probability),
                *[func.sum(case((Transaction.risk_label == label, 1), else_=0)) for label in RISK_LABELS],
            ).where(Transaction.merchant_id == str(merchant_id))).one()
            total, flagged = int(row[0]), int(row[1] or 0)
            return {"total": total, "flagged": flagged, "fraudRate": flagged / total if total else 0,
                    "avgProbability": float(row[2] or 0), "byRisk": {label: int(row[index + 3] or 0) for index, label in enumerate(RISK_LABELS)},
                    "series24h": self._series(session, merchant_id, now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=23), 24, "hour"),
                    "series30d": self._series(session, merchant_id, now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=29), 30, "day")}

    def score_histogram(self, merchant_id: str) -> dict:
        probability = Transaction.fraud_probability
        expressions = [func.sum(case(((probability >= index / 10) &
                                      ((probability < (index + 1) / 10) if index < 9 else (probability <= 1)), 1), else_=0)) for index in range(10)]
        with self._session() as session:
            counts = session.execute(select(*expressions).where(Transaction.merchant_id == str(merchant_id))).one()
            return {"bins": [{"from": index / 10, "to": (index + 1) / 10, "count": int(counts[index] or 0)} for index in range(10)]}

    def create_checkout(self, data: dict) -> dict:
        with self._session() as session:
            row = PaymentCheckout(id=record_id(data), razorpay_order_id=data["razorpayOrderId"],
                                  merchant_id=str(data["merchantId"]), amount_paise=data["amountPaise"],
                                  currency=data["currency"].lower(), mode=data["mode"], payment_mode=data.get("paymentMode"),
                                  expires_at=as_utc(data["expiresAt"]), created_at=as_utc(data.get("createdAt") or utc_now()))
            session.add(row)
            session.flush()
            return checkout_record(row)

    def get_checkout(self, order_id: str, merchant_id: str | None = None) -> dict | None:
        with self._session() as session:
            query = select(PaymentCheckout).where(PaymentCheckout.razorpay_order_id == order_id)
            if merchant_id is not None:
                query = query.where(PaymentCheckout.merchant_id == str(merchant_id))
            row = session.scalar(query)
            return checkout_record(row) if row else None

    def record_webhook(self, event_id: str, event_type: str, payload_digest: str, *, payment_id: str | None = None) -> dict:
        try:
            with self._session() as session:
                row = WebhookEvent(id=event_id, event_type=event_type, payload_digest=payload_digest,
                                   payment_id=payment_id, status="received")
                session.add(row)
                session.flush()
                return webhook_record(row)
        except DuplicateRecordError:
            existing = self.get_webhook(event_id)
            if existing is None or existing["payloadDigest"] != payload_digest or existing["eventType"] != event_type:
                raise ValueError("Webhook event ID was reused with a different payload.") from None
            return existing

    def get_webhook(self, event_id: str) -> dict | None:
        with self._session() as session:
            row = session.get(WebhookEvent, event_id)
            return webhook_record(row) if row else None

    def complete_webhook(self, event_id: str, *, transaction_id: str | None = None) -> dict | None:
        with self._session() as session:
            row = session.get(WebhookEvent, event_id, with_for_update=True)
            if row is None:
                return None
            if row.status != "completed":
                row.status, row.completed_at, row.transaction_id = "completed", utc_now(), transaction_id
                session.flush()
            return webhook_record(row)
