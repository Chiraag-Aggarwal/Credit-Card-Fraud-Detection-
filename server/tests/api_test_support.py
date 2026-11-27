"""Isolated API tests: no provider network calls, optional real PostgreSQL."""

from datetime import datetime, timezone
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.engine import make_url
from sqlalchemy.schema import CreateSchema, DropSchema

from app.main import app, _rate_limit_windows
from app.security import hash_password, issue_session
from app.storage import Repository, database_engine
from scripts.migrate_database import upgrade_database


TEST_SECRET = "api-test-secret-only-not-for-production-123456"
PAYMENT_SECRET = "test-only-provider-secret"
WEBHOOK_SECRET = "test-only-webhook-secret"


class ApiTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password_hash = hash_password("profile-test-password")

    def setUp(self):
        environment = patch.dict(os.environ, {
            "JWT_SECRET": TEST_SECRET, "PAYMENTS_ENABLED": "false", "ALLOW_LIVE_PAYMENTS": "false",
            "RAZORPAY_KEY_ID": "rzp_test_fixture", "RAZORPAY_KEY_SECRET": PAYMENT_SECRET,
            "RAZORPAY_WEBHOOK_SECRET": WEBHOOK_SECRET, "CLIENT_URL": "http://localhost:5173",
            "ML_SERVICE_URL": "http://model.invalid", "ML_API_KEY": "test-only-model-key",
        })
        environment.start()
        self.addCleanup(environment.stop)
        _rate_limit_windows.clear()
        if os.getenv("TEST_DATABASE_URL"):
            database_url = os.environ["TEST_DATABASE_URL"]
            admin = database_engine(database_url)
            schema = "api_test_" + uuid.uuid4().hex
            with admin.begin() as connection:
                connection.execute(CreateSchema(schema))
            def remove_schema():
                with admin.begin() as connection:
                    connection.execute(DropSchema(schema, cascade=True))
                admin.dispose()
            self.addCleanup(remove_schema)
            url = make_url(database_url).update_query_dict({"options": "-csearch_path=" + schema}).render_as_string(hide_password=False)
            upgrade_database(url)
            self.repository = Repository(url)
        else:
            temporary = tempfile.TemporaryDirectory()
            self.addCleanup(temporary.cleanup)
            url = "sqlite:///" + (Path(temporary.name) / "api.sqlite").as_posix()
            self.repository = Repository(url, allow_sqlite=True)
            self.repository.create_schema()
        self.addCleanup(self.repository.close)
        self.owner = self.repository.create_user({"name": "First User", "email": "first@example.com", "passwordHash": self.password_hash})
        self.other = self.repository.create_user({"name": "Second User", "email": "second@example.com", "passwordHash": self.password_hash})
        self.owner_id, self.other_id = self.owner["_id"], self.other["_id"]
        app.state.db = self.repository
        # Lifespan startup requires deployed PostgreSQL configuration; repository
        # setup above exercises real persistence without starting those services.
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.headers = {"Authorization": "Bearer " + issue_session(self.repository, self.owner)}
        for method in ("request", "post", "get"):
            network = patch("app.main.httpx." + method, side_effect=AssertionError("Unexpected external HTTP call in API tests"))
            network.start()
            self.addCleanup(network.stop)

    def transaction(self, **changes):
        return self.repository.create_transaction({
            "merchantId": self.owner_id, "displayAmount": "19.99", "currency": "inr", "source": "simulated",
            "features": {"Time": 1, **{f"V{i}": 0 for i in range(1, 29)}, "Amount": 19.99},
            "riskLabel": "HIGH", "isFlagged": True, "fraudProbability": 0.95,
            "scoringStatus": "scored", "modelVersion": "fixture", "createdAt": datetime.now(timezone.utc), **changes,
        })
