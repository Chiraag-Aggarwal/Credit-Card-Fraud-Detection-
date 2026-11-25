"""Repository contracts run on SQLite and an opt-in isolated PostgreSQL schema.

Set TEST_DATABASE_URL to a disposable PostgreSQL database to run both backends.
The PostgreSQL role needs CREATE SCHEMA; only randomly named test schemas are
removed, never existing application tables. No live payment service is called.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
from pathlib import Path
import tempfile
import unittest
import uuid

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateSchema, DropSchema

from app.storage import Base, DuplicateRecordError, Repository, database_engine
from scripts.migrate_database import upgrade_database
from scripts.migrate_mongodb import MigrationConflict, import_records


NOW = datetime(2026, 11, 25, 12, 30, tzinfo=timezone.utc)


class RepositoryContract:
    postgres = False

    def setUp(self):
        if self.postgres:
            original_url = os.environ["TEST_DATABASE_URL"]
            admin = database_engine(original_url)
            schema = "storage_test_" + uuid.uuid4().hex
            with admin.begin() as connection:
                connection.execute(CreateSchema(schema))
            def remove_schema():
                with admin.begin() as connection:
                    connection.execute(DropSchema(schema, cascade=True))
                admin.dispose()
            self.addCleanup(remove_schema)
            url = make_url(original_url).update_query_dict({"options": "-csearch_path=" + schema}).render_as_string(hide_password=False)
            self.database_url = url
            upgrade_database(url)
            self.repository = Repository(url)
        else:
            temporary = tempfile.TemporaryDirectory()
            self.addCleanup(temporary.cleanup)
            self.database_url = "sqlite:///" + (Path(temporary.name) / "storage.sqlite").as_posix()
            upgrade_database(self.database_url, allow_sqlite=True)
            self.repository = Repository(self.database_url, allow_sqlite=True)
        self.addCleanup(self.repository.close)
        self.owner = self.repository.create_user({"_id": "507f1f77bcf86cd799439011", "name": "Owner", "email": "owner@example.com", "passwordHash": "existing-hash", "createdAt": NOW})
        self.other = self.repository.create_user({"name": "Other", "email": "other@example.com", "passwordHash": "another-hash", "createdAt": NOW})

    def transaction(self, **changes):
        return self.repository.create_transaction({
            "merchantId": self.owner["_id"], "displayAmount": "19.99", "currency": "inr", "source": "simulated",
            "features": {"Amount": 19.99, "Time": 1, "V1": -2.5}, "riskLabel": "HIGH", "isFlagged": True,
            "fraudProbability": 0.9, "scoringStatus": "scored", "modelVersion": "test-model", "createdAt": NOW,
            **changes,
        })

    def test_migrations_are_repeatable_and_match_models(self):
        upgrade_database(self.database_url, allow_sqlite=not self.postgres)
        self.repository.check_schema()
        self.assertTrue(self.repository.ping())
        with self.repository.engine.connect() as connection:
            differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)
        self.assertEqual(differences, [])

    def test_user_identity_and_password_survive_profile_change_and_duplicate_rollback(self):
        updated = self.repository.update_user(self.owner["_id"], name="Renamed", email="RENAMED@EXAMPLE.COM")
        self.assertEqual(updated["_id"], "507f1f77bcf86cd799439011")
        self.assertEqual(updated["passwordHash"], "existing-hash")
        self.assertEqual(self.repository.get_user_by_email("RENAMED@EXAMPLE.COM")["_id"], updated["_id"])
        with self.assertRaises(DuplicateRecordError):
            self.repository.update_user(updated["_id"], name="Must roll back", email=self.other["email"])
        self.assertEqual(self.repository.get_user(updated["_id"])["name"], "Renamed")
        with self.assertRaises(DuplicateRecordError):
            self.repository.create_user({"name": "Collision", "email": "RENAMED@EXAMPLE.COM", "passwordHash": "x"})

    def test_transaction_decimal_dates_pagination_and_merchant_isolation(self):
        first = self.transaction(createdAt=NOW - timedelta(hours=1), riskLabel="LOW", isFlagged=False)
        newest = self.transaction(displayAmount=Decimal("999999.99"), createdAt=NOW.astimezone(timezone(timedelta(hours=5, minutes=30))))
        self.transaction(merchantId=self.other["_id"])
        self.assertEqual(newest["displayAmount"], Decimal("999999.99"))
        self.assertEqual(newest["createdAt"], NOW)
        self.assertEqual(newest["createdAt"].utcoffset(), timedelta(0))
        self.assertIsNone(self.repository.get_transaction(newest["_id"], self.other["_id"]))
        rows, total = self.repository.list_transactions(self.owner["_id"], page=2, limit=1)
        self.assertEqual(total, 2)
        self.assertEqual(rows[0]["_id"], first["_id"])
        rows, total = self.repository.list_transactions(self.owner["_id"], flagged=True, risk_label="HIGH", from_date=NOW, to_date=NOW)
        self.assertEqual(total, 1)
        self.assertEqual(rows[0]["_id"], newest["_id"])

    def test_review_updates_alert_state_and_audit_without_overwriting_model(self):
        transaction = self.transaction()
        self.assertEqual(self.repository.unread_count(self.owner["_id"]), 1)
        self.assertIsNone(self.repository.review_transaction(transaction["_id"], self.other["_id"], "legit"))
        updated = self.repository.review_transaction(transaction["_id"], self.owner["_id"], "legit")
        self.assertFalse(updated["isFlagged"])
        self.assertEqual(updated["fraudProbability"], 0.9)
        self.assertEqual(updated["riskLabel"], "HIGH")
        self.assertEqual(updated["reviewedBy"], self.owner["_id"])
        self.assertIsNotNone(updated["reviewedAt"])
        self.assertEqual(self.repository.unread_count(self.owner["_id"]), 0)
        updated = self.repository.review_transaction(transaction["_id"], self.owner["_id"], "confirmed_fraud")
        self.assertTrue(updated["isFlagged"])
        self.assertEqual(self.repository.unread_count(self.owner["_id"]), 0)

    def test_database_constraints_reject_orphans_and_invalid_probabilities(self):
        with self.assertRaises(IntegrityError):
            self.transaction(merchantId="missing-user")
        with self.assertRaises(IntegrityError):
            self.transaction(fraudProbability=1.01)
        with self.assertRaises(IntegrityError):
            self.transaction(displayAmount="-0.01")
        self.assertEqual(self.repository.list_transactions(self.owner["_id"])[1], 0)

    def test_payment_id_uniqueness_and_durable_webhook_retry(self):
        payment = self.transaction(source="razorpay", razorpayPaymentId="pay_test_one", razorpayOrderId="order_test_one", paymentMode="test")
        with self.assertRaises(DuplicateRecordError):
            self.transaction(razorpayPaymentId="pay_test_one")
        self.assertEqual(self.repository.get_transaction_by_payment("pay_test_one")["_id"], payment["_id"])
        event = self.repository.record_webhook("event_one", "payment.captured", "a" * 64, payment_id="pay_test_one")
        self.assertEqual(event["status"], "received")
        retry = self.repository.record_webhook("event_one", "payment.captured", "a" * 64, payment_id="pay_test_one")
        self.assertEqual(retry["receivedAt"], event["receivedAt"])
        with self.assertRaises(ValueError):
            self.repository.record_webhook("event_one", "payment.captured", "b" * 64)
        self.repository.complete_webhook("event_one", transaction_id=payment["_id"])
        second = Repository(self.database_url, allow_sqlite=not self.postgres)
        try:
            durable = second.get_webhook("event_one")
            self.assertEqual(durable["status"], "completed")
            self.assertEqual(durable["transactionId"], payment["_id"])
            self.assertEqual(second.get_transaction_by_payment("pay_test_one")["_id"], payment["_id"])
        finally:
            second.close()

    def test_checkout_order_uniqueness_ownership_and_expiry_preservation(self):
        data = {"razorpayOrderId": "order_one", "merchantId": self.owner["_id"], "amountPaise": 12345,
                "currency": "INR", "mode": "normal", "paymentMode": "test", "expiresAt": NOW + timedelta(days=90), "createdAt": NOW}
        checkout = self.repository.create_checkout(data)
        self.assertEqual(checkout["currency"], "inr")
        self.assertEqual(checkout["expiresAt"], NOW + timedelta(days=90))
        self.assertIsNone(self.repository.get_checkout("order_one", self.other["_id"]))
        self.assertEqual(self.repository.get_checkout("order_one", self.owner["_id"])["amountPaise"], 12345)
        with self.assertRaises(DuplicateRecordError):
            self.repository.create_checkout(data)

    def test_statistics_zero_fill_utc_boundaries_histogram_and_null_scores(self):
        empty = self.repository.transaction_stats(self.owner["_id"], now=NOW)
        self.assertEqual(empty["total"], 0)
        self.assertEqual(len(empty["series24h"]), 24)
        self.assertEqual(len(empty["series30d"]), 30)
        self.transaction(fraudProbability=0, riskLabel="LOW", isFlagged=False, createdAt=NOW.replace(hour=0, minute=0))
        self.transaction(fraudProbability=0.1, riskLabel="MEDIUM", isFlagged=False)
        self.transaction(fraudProbability=1)
        self.transaction(fraudProbability=None, riskLabel="UNSCORED", scoringStatus="pending_review")
        self.transaction(merchantId=self.other["_id"], fraudProbability=0.5)
        summary = self.repository.transaction_stats(self.owner["_id"], now=NOW)
        self.assertEqual(summary["total"], 4)
        self.assertEqual(summary["flagged"], 2)
        self.assertAlmostEqual(summary["avgProbability"], 1.1 / 3)
        self.assertEqual(summary["byRisk"], {"LOW": 1, "MEDIUM": 1, "HIGH": 1, "UNSCORED": 1})
        self.assertEqual(sum(row["total"] for row in summary["series24h"]), 4)
        self.assertEqual(summary["series30d"][-1]["total"], 4)
        self.assertEqual(summary["series24h"][-1]["t"], "2026-11-25T12:00:00.000Z")
        self.assertEqual([row["count"] for row in self.repository.score_histogram(self.owner["_id"])["bins"]], [1, 1, 0, 0, 0, 0, 0, 0, 0, 1])

    def test_mongo_import_preview_idempotency_preserved_ids_and_conflicts(self):
        users = [{"_id": "507f1f77bcf86cd799439012", "name": "Imported", "email": "IMPORTED@EXAMPLE.COM", "passwordHash": "original-bcrypt-hash", "createdAt": NOW}]
        transactions = [{"_id": "507f1f77bcf86cd799439013", "merchantId": users[0]["_id"], "displayAmount": 12.34,
                         "currency": "INR", "source": "razorpay", "features": {"Amount": 12.34}, "createdAt": NOW,
                         "razorpayPaymentId": "pay_imported", "riskLabel": "HIGH", "isFlagged": True,
                         "fraudProbability": 0.9, "scoringStatus": "scored"}]
        checkouts = [{"_id": "507f1f77bcf86cd799439014", "merchantId": users[0]["_id"], "razorpayOrderId": "order_imported", "amountPaise": 1234,
                      "currency": "INR", "mode": "normal", "createdAt": NOW, "expiresAt": NOW + timedelta(days=90)}]
        preview = import_records(self.repository, users, transactions, checkouts)
        self.assertEqual(preview["transactions"]["wouldInsert"], 1)
        self.assertIsNone(self.repository.get_user(users[0]["_id"]))
        report = import_records(self.repository, users, transactions, checkouts, apply=True)
        self.assertEqual(report["transactions"]["inserted"], 1)
        self.assertEqual(report["transactions"]["paymentScoresCleared"], 1)
        migrated = self.repository.get_transaction(transactions[0]["_id"], users[0]["_id"])
        self.assertEqual(migrated["riskLabel"], "UNSCORED")
        self.assertEqual(migrated["scoringReason"], "unsupported_payment_features")
        self.assertIsNone(migrated["fraudProbability"])
        self.assertEqual(migrated["features"], {})
        repeat = import_records(self.repository, users, transactions, checkouts, apply=True)
        self.assertEqual(repeat["users"]["skipped"], 1)
        self.assertEqual(repeat["transactions"]["skipped"], 1)
        self.assertEqual(self.repository.get_user(users[0]["_id"])["passwordHash"], "original-bcrypt-hash")
        transactions[0]["displayAmount"] = 99.99
        with self.assertRaises(MigrationConflict):
            import_records(self.repository, users, transactions, checkouts, apply=True)
        self.assertEqual(self.repository.get_transaction(transactions[0]["_id"], users[0]["_id"])["displayAmount"], Decimal("12.34"))

    def test_mongo_import_preserves_stripe_event_ids_and_normalizes_review_flags(self):
        common = {"merchantId": self.owner["_id"], "displayAmount": 12.34, "currency": "inr",
                  "features": {"Amount": 12.34}, "createdAt": NOW, "riskLabel": "HIGH",
                  "fraudProbability": 0.9, "scoringStatus": "scored", "modelVersion": "original-model"}
        transactions = [
            {**common, "_id": "legacy-simulation-legit", "source": "simulated", "reviewDecision": "legit", "isFlagged": True},
            {**common, "_id": "legacy-simulation-fraud", "source": "simulated", "reviewDecision": "confirmed_fraud", "isFlagged": False},
            {**common, "_id": "legacy-stripe", "source": "stripe", "stripePaymentIntentId": "pi_legacy",
             "stripeEventId": "evt_legacy", "reviewDecision": "legit", "isFlagged": True},
        ]
        report = import_records(self.repository, [], transactions, [], apply=True)
        self.assertEqual(report["transactions"]["inserted"], 3)
        legit = self.repository.get_transaction("legacy-simulation-legit", self.owner["_id"])
        self.assertFalse(legit["isFlagged"])
        self.assertEqual(legit["reviewDecision"], "legit")
        self.assertEqual(legit["fraudProbability"], 0.9)
        self.assertEqual(legit["modelVersion"], "original-model")
        self.assertTrue(self.repository.get_transaction("legacy-simulation-fraud", self.owner["_id"])["isFlagged"])
        stripe = self.repository.get_transaction("legacy-stripe", self.owner["_id"])
        self.assertEqual(stripe["stripeEventId"], "evt_legacy")
        self.assertEqual(stripe["stripePaymentIntentId"], "pi_legacy")
        self.assertFalse(stripe["isFlagged"])
        self.assertIsNone(stripe["fraudProbability"])
        self.assertEqual(import_records(self.repository, [], transactions, [], apply=True)["transactions"]["skipped"], 3)
        with self.assertRaises(DuplicateRecordError):
            self.transaction(stripeEventId="evt_legacy")


class SQLiteRepositoryTests(RepositoryContract, unittest.TestCase):
    pass


@unittest.skipUnless(os.getenv("TEST_DATABASE_URL"), "TEST_DATABASE_URL was not provided")
class PostgreSQLRepositoryTests(RepositoryContract, unittest.TestCase):
    postgres = True


class DatabaseConfigurationTests(unittest.TestCase):
    def test_sqlite_and_missing_urls_are_rejected_by_default(self):
        for url in ("", "sqlite:///:memory:", "mysql://localhost/demo"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                Repository(url)


if __name__ == "__main__":
    unittest.main()
