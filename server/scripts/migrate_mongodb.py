"""Copy legacy MongoDB records into PostgreSQL without altering the source.

Install requirements-migration.txt, apply SQL migrations, stop legacy writers,
then run without arguments for a preview or with --apply to import. A second
run skips records with matching IDs and contents; conflicts fail visibly.
Database URLs are read exclusively from the environment and never printed.
"""

import argparse
from datetime import datetime
from decimal import Decimal
import os
from pathlib import Path
import sys

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from dotenv import load_dotenv
from app.storage import Repository, as_utc


class MigrationConflict(Exception):
    pass


def normalize(value):
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, datetime):
        return as_utc(value)
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "to_decimal"):
        return float(value.to_decimal())
    if type(value).__name__ == "ObjectId":
        return str(value)
    return value


def comparable(value):
    if isinstance(value, (int, float, Decimal)) and not isinstance(value, bool):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {key: comparable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [comparable(item) for item in value]
    return normalize(value)


def assert_matches(existing: dict, source: dict, fields: set[str]):
    for key in fields:
        if key in source and comparable(existing.get(key)) != comparable(source[key]):
            raise MigrationConflict("An existing destination record differs from the source; no existing data was overwritten.")


def import_records(repository: Repository, users, transactions, checkouts, *, apply: bool = False) -> dict:
    """Streaming importer, independently testable without a MongoDB connection.

    Each row commits separately so interruption is resumable. Existing rows are
    never overwritten. A reported error may follow successful earlier inserts.
    """
    report = {name: {"inserted": 0, "skipped": 0, "wouldInsert": 0, "paymentScoresCleared": 0} for name in ("users", "payment_checkouts", "transactions")}
    known_users: set[str] = set()
    for raw in users:
        source = normalize(raw)
        source["_id"] = str(source["_id"])
        source["email"] = source["email"].strip().lower()
        source.setdefault("role", "merchant")
        if not source.get("createdAt"):
            raise MigrationConflict("A source user is missing its creation timestamp.")
        existing = repository.get_user(source["_id"])
        if existing:
            assert_matches(existing, source, {"_id", "name", "email", "passwordHash", "role", "createdAt"})
            report["users"]["skipped"] += 1
        else:
            if repository.get_user_by_email(source["email"]):
                raise MigrationConflict("A destination email belongs to a different user ID.")
            if apply:
                repository.create_user(source)
            report["users"]["inserted" if apply else "wouldInsert"] += 1
        known_users.add(source["_id"])

    for name, documents in (("payment_checkouts", checkouts), ("transactions", transactions)):
        for raw in documents:
            source = normalize(raw)
            source["_id"], source["merchantId"] = str(source["_id"]), str(source["merchantId"])
            source["currency"] = source["currency"].lower()
            if not source.get("createdAt"):
                raise MigrationConflict("A source record is missing its creation timestamp.")
            if source["merchantId"] not in known_users and not repository.get_user(source["merchantId"]):
                raise MigrationConflict("A source record references a missing merchant; repair the source before retrying.")
            if name == "payment_checkouts":
                existing = repository.get_checkout(source["razorpayOrderId"])
                create = repository.create_checkout
            else:
                amount = raw["displayAmount"]
                source["displayAmount"] = Decimal(str(amount.to_decimal() if hasattr(amount, "to_decimal") else amount))
                if source.get("source") in {"razorpay", "stripe"}:
                    # Historical payment scores came from unrelated replay rows.
                    # Retain the untouched source backup, never represent those
                    # synthetic predictions as a score for an actual payment.
                    source.update(features={}, groundTruthLabel=None, fraudProbability=None,
                                  riskLabel="UNSCORED", scoringStatus="pending_review",
                                  scoringReason="unsupported_payment_features", modelVersion="",
                                  isFlagged=source.get("reviewDecision") != "legit")
                    report[name]["paymentScoresCleared"] += 1
                if source.get("reviewDecision") in {"legit", "confirmed_fraud"}:
                    # Older review endpoints did not update the alert flag.
                    # Preserve the human decision and model result separately.
                    source["isFlagged"] = source["reviewDecision"] == "confirmed_fraud"
                existing = repository.get_transaction(source["_id"], source["merchantId"])
                create = repository.create_transaction
                payment_id = source.get("razorpayPaymentId")
                payment = repository.get_transaction_by_payment(payment_id) if payment_id else None
                if payment is not None and payment["_id"] != source["_id"]:
                    raise MigrationConflict("A destination payment belongs to a different transaction ID.")
            if existing:
                assert_matches(existing, source, set(existing))
                report[name]["skipped"] += 1
            else:
                if apply:
                    create(source)
                report[name]["inserted" if apply else "wouldInsert"] += 1
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Insert source records; omitted means a read-only preview.")
    args = parser.parse_args()
    load_dotenv(SERVER_ROOT / ".env")
    client = repository = None
    try:
        from pymongo import MongoClient
        uri = os.getenv("MONGODB_URI", "").strip()
        if not uri:
            raise ValueError("MONGODB_URI is required for this importer.")
        repository = Repository(os.getenv("DATABASE_URL", ""))
        repository.check_schema()
        client = MongoClient(uri, serverSelectionTimeoutMS=10000, tz_aware=True)
        client.admin.command("ping")
        database_name = os.getenv("MONGODB_DATABASE")
        source = client[database_name] if database_name else client.get_default_database()
        if source is None:
            raise ValueError("A MongoDB database name is required.")
        report = import_records(repository, source.users.find({}), source.transactions.find({}), source.payment_checkouts.find({}), apply=args.apply)
        print("Import finished." if args.apply else "Preview finished; pass --apply to import. Stop legacy writers before the final import.")
        for name, counts in report.items():
            print(f"{name}: inserted={counts['inserted']} skipped={counts['skipped']} would_insert={counts['wouldInsert']} payment_scores_cleared={counts['paymentScoresCleared']}")
        return 0
    except MigrationConflict as error:
        print(f"Import stopped: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        print(f"Import stopped ({type(error).__name__}). Check source data, dependencies, and database access. Existing records were not overwritten; earlier inserts can be resumed.", file=sys.stderr)
        return 1
    finally:
        if client is not None:
            client.close()
        if repository is not None:
            repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
