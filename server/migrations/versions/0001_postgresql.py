"""Initial relational schema with immutable IDs and durable payment receipts."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "0001_postgresql"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("email", sa.String(254), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("email = lower(email)", name="ck_users_email_lowercase"),
    )
    op.create_table(
        "transactions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("merchant_id", sa.String(64), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("display_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("features", sa.JSON().with_variant(JSONB(), "postgresql"), nullable=False),
        sa.Column("ground_truth_label", sa.Integer()),
        sa.Column("fraud_probability", sa.Float()),
        sa.Column("risk_label", sa.String(16), nullable=False),
        sa.Column("is_flagged", sa.Boolean(), nullable=False),
        sa.Column("scoring_status", sa.String(32), nullable=False),
        sa.Column("scoring_reason", sa.Text()),
        sa.Column("model_version", sa.String(200), nullable=False),
        sa.Column("review_decision", sa.String(32)),
        sa.Column("reviewed_at", sa.DateTime(timezone=True)),
        sa.Column("reviewed_by", sa.String(64), sa.ForeignKey("users.id", ondelete="RESTRICT")),
        sa.Column("stripe_payment_intent_id", sa.String(255), unique=True),
        sa.Column("razorpay_payment_id", sa.String(255), unique=True),
        sa.Column("razorpay_order_id", sa.String(255)),
        sa.Column("razorpay_event_id", sa.String(255)),
        sa.Column("payment_mode", sa.String(16)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("display_amount >= 0", name="ck_transactions_amount"),
        sa.CheckConstraint("fraud_probability IS NULL OR (fraud_probability >= 0 AND fraud_probability <= 1)", name="ck_transactions_probability"),
        sa.CheckConstraint("risk_label IN ('LOW','MEDIUM','HIGH','UNSCORED')", name="ck_transactions_risk"),
        sa.CheckConstraint("scoring_status IN ('scored','pending_review')", name="ck_transactions_scoring"),
        sa.CheckConstraint("review_decision IS NULL OR review_decision IN ('confirmed_fraud','legit')", name="ck_transactions_review"),
    )
    op.create_index("ix_transactions_merchant_created", "transactions", ["merchant_id", "created_at"])
    op.create_index("ix_transactions_merchant_scoring", "transactions", ["merchant_id", "scoring_status"])
    op.create_index("ix_transactions_merchant_flagged_review", "transactions", ["merchant_id", "is_flagged", "review_decision"])
    op.create_index("ix_transactions_razorpay_order_id", "transactions", ["razorpay_order_id"])
    op.create_table(
        "payment_checkouts",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("razorpay_order_id", sa.String(255), nullable=False, unique=True),
        sa.Column("merchant_id", sa.String(64), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("amount_paise", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("mode", sa.String(32), nullable=False),
        sa.Column("payment_mode", sa.String(16)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount_paise > 0", name="ck_payment_checkouts_amount"),
    )
    op.create_index("ix_payment_checkouts_merchant_created", "payment_checkouts", ["merchant_id", "created_at"])
    op.create_index("ix_payment_checkouts_expires_at", "payment_checkouts", ["expires_at"])
    op.create_table(
        "webhook_events",
        sa.Column("id", sa.String(255), primary_key=True),
        sa.Column("event_type", sa.String(120), nullable=False),
        sa.Column("payload_digest", sa.String(64), nullable=False),
        sa.Column("payment_id", sa.String(255)),
        sa.Column("transaction_id", sa.String(64), sa.ForeignKey("transactions.id", ondelete="RESTRICT")),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("status IN ('received','completed')", name="ck_webhook_events_status"),
    )
    op.create_index("ix_webhook_events_payment_id", "webhook_events", ["payment_id"])
    op.create_index("ix_webhook_events_status", "webhook_events", ["status"])


def downgrade():
    raise RuntimeError("This migration contains durable payment data. Restore a verified backup to roll back.")
