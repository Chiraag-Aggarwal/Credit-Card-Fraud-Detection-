"""Account lifecycle tests run on SQLite and on PostgreSQL when configured in CI."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from alembic import command
from alembic.config import Config
import jwt
from sqlalchemy import select, text

from app.security import hash_password, issue_session, issue_token, new_recovery_codes, recovery_digest, verify_password
from app.storage import AuthSession, RecoveryCode, Repository, database_engine
from scripts.migrate_database import SERVER_ROOT, upgrade_database
from tests.api_test_support import ApiTestCase, TEST_SECRET


class AccountSecurityTests(ApiTestCase):
    def codes(self):
        response = self.client.post("/api/auth/recovery-codes", json={"currentPassword": "profile-test-password"}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["recoveryCodes"]

    def recover(self, code, *, email="first@example.com", password="new-secure-password"):
        return self.client.post("/api/auth/recover", json={"email": email, "recoveryCode": code, "newPassword": password})

    def test_registration_returns_eight_private_codes_once_and_stores_only_digests(self):
        response = self.client.post("/api/auth/register", json={"name": "New account", "email": "new@example.com", "password": "  preserved-password  "})
        self.assertEqual(response.status_code, 201)
        data = response.json()
        codes = data["recoveryCodes"]
        self.assertEqual(len(codes), 8)
        self.assertEqual(len(set(codes)), 8)
        for code in codes:
            self.assertRegex(code, r"^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$")
        self.assertEqual(set(data["user"]), {"id", "name", "email", "role"})
        with self.repository.sessions() as session:
            rows = list(session.scalars(select(RecoveryCode).where(RecoveryCode.user_id == data["user"]["id"])))
            self.assertEqual({row.code_hash for row in rows}, {recovery_digest(code) for code in codes})
            self.assertTrue(all(row.used_at is None for row in rows))
        logged_in = self.client.post("/api/auth/login", json={"email": "new@example.com", "password": "  preserved-password  "})
        self.assertEqual(logged_in.status_code, 200)
        self.assertNotIn("recoveryCodes", logged_in.json())
        headers = {"Authorization": "Bearer " + data["token"]}
        self.assertEqual(self.client.get("/api/auth/security", headers=headers).json(), {"recoveryCodesRemaining": 8})

    def test_logout_revokes_only_that_session_and_survives_new_repository_instance(self):
        second = {"Authorization": "Bearer " + issue_session(self.repository, self.owner)}
        response = self.client.post("/api/auth/logout", headers=self.headers)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.content, b"")
        self.assertEqual(self.client.get("/api/auth/me", headers=self.headers).status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers=second).status_code, 200)
        payload = jwt.decode(second["Authorization"][7:], TEST_SECRET, algorithms=["HS256"], audience="fraud-dashboard", issuer="fraud-api")
        # A second engine reads committed session state; revocation is not process memory.
        other_repository = Repository(self.repository.engine.url.render_as_string(hide_password=False), allow_sqlite=True)
        try:
            self.assertIsNotNone(other_repository.authenticated_user(self.owner_id, payload["sid"], payload["ver"]))
            other_repository.revoke_session(self.owner_id, payload["sid"])
            self.assertEqual(self.client.get("/api/auth/me", headers=second).status_code, 401)
        finally:
            other_repository.close()

    def test_logout_all_revokes_all_tokens_but_allows_a_new_password_login(self):
        second = {"Authorization": "Bearer " + issue_session(self.repository, self.owner)}
        foreign = {"Authorization": "Bearer " + issue_session(self.repository, self.other)}
        self.assertEqual(self.client.post("/api/auth/logout-all", headers=self.headers).status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.headers).status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers=second).status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers=foreign).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "first@example.com", "password": "profile-test-password"}).status_code, 200)

    def test_password_change_requires_current_password_and_replaces_all_sessions(self):
        second = {"Authorization": "Bearer " + issue_session(self.repository, self.owner)}
        wrong = self.client.post("/api/auth/change-password", json={"currentPassword": "wrong", "newPassword": "new-password"}, headers=self.headers)
        self.assertEqual(wrong.status_code, 403)
        self.assertEqual(wrong.json()["error"]["code"], "CURRENT_PASSWORD_INVALID")
        self.assertEqual(self.client.get("/api/auth/me", headers=self.headers).status_code, 200)
        changed = self.client.post("/api/auth/change-password", json={"currentPassword": "profile-test-password", "newPassword": "  new-password  "}, headers=self.headers)
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(set(changed.json()), {"token", "user"})
        self.assertEqual(changed.json()["user"]["id"], self.owner_id)
        for headers in (self.headers, second):
            self.assertEqual(self.client.get("/api/auth/me", headers=headers).status_code, 401)
        self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + changed.json()["token"]}).status_code, 200)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "first@example.com", "password": "profile-test-password"}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "first@example.com", "password": "  new-password  "}).status_code, 200)

    def test_recovery_is_single_use_revokes_sessions_and_does_not_return_a_token(self):
        codes = self.codes()
        transaction = self.transaction()
        response = self.recover(codes[0].lower().replace("-", " "))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"message": "Password reset. Sign in with your new password."})
        self.assertEqual(self.client.get("/api/auth/me", headers=self.headers).status_code, 401)
        self.assertEqual(self.repository.recovery_codes_remaining(self.owner_id), 7)
        self.assertEqual(self.recover(codes[0], password="must-not-replace-password").status_code, 400)
        self.assertTrue(verify_password("new-secure-password", self.repository.get_user(self.owner_id)["passwordHash"]))
        self.assertEqual(self.repository.get_transaction(transaction["_id"], self.owner_id)["displayAmount"], transaction["displayAmount"])
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "first@example.com", "password": "profile-test-password"}).status_code, 401)

    def test_recovery_does_not_disclose_missing_accounts_or_accept_another_users_code(self):
        codes = self.codes()
        missing = self.recover(codes[0], email="absent@example.com")
        incorrect = self.recover("wrong-code")
        foreign = self.recover(codes[0], email="second@example.com")
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(missing.json(), incorrect.json())
        self.assertEqual(foreign.json(), incorrect.json())
        self.assertEqual(self.repository.recovery_codes_remaining(self.owner_id), 8)
        self.assertEqual(self.repository.get_user(self.other_id)["passwordHash"], self.password_hash)

    def test_code_regeneration_requires_reauthentication_and_invalidates_old_codes(self):
        original = self.codes()
        bad = self.client.post("/api/auth/recovery-codes", json={"currentPassword": "incorrect"}, headers=self.headers)
        self.assertEqual(bad.status_code, 403)
        self.assertEqual(self.repository.recovery_codes_remaining(self.owner_id), 8)
        replacement = self.codes()
        self.assertFalse(set(original).intersection(replacement))
        self.assertEqual(self.recover(original[0]).status_code, 400)
        self.assertEqual(self.recover(replacement[0]).status_code, 200)

    def test_legacy_fabricated_and_expired_sessions_are_rejected(self):
        now = datetime.now(timezone.utc)
        legacy = jwt.encode({"sub": self.owner_id, "role": "merchant", "type": "access", "aud": "fraud-dashboard",
                             "iss": "fraud-api", "iat": now, "exp": now + timedelta(days=1)}, TEST_SECRET, algorithm="HS256")
        fabricated = issue_token(self.owner_id, "merchant")
        for token in (legacy, fabricated):
            self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + token}).status_code, 401)
        with self.repository.sessions.begin() as session:
            for row in session.scalars(select(AuthSession).where(AuthSession.user_id == self.owner_id)):
                row.expires_at = now - timedelta(seconds=1)
        self.assertEqual(self.client.get("/api/auth/me", headers=self.headers).status_code, 401)

    def test_email_change_requires_current_password_and_cannot_change_privileges(self):
        body = {"name": "Owner", "email": "new@example.com"}
        self.assertEqual(self.client.patch("/api/auth/me", json=body, headers=self.headers).json()["error"]["code"], "CURRENT_PASSWORD_REQUIRED")
        self.assertEqual(self.client.patch("/api/auth/me", json={**body, "currentPassword": "wrong"}, headers=self.headers).status_code, 403)
        self.assertEqual(self.repository.get_user(self.owner_id)["email"], "first@example.com")
        self.assertEqual(self.client.patch("/api/auth/me", json={**body, "currentPassword": "profile-test-password", "authVersion": 0}, headers=self.headers).status_code, 422)

    def test_stale_name_only_update_cannot_restore_old_email_without_reauthentication(self):
        # Another verified request changes email after the stale request has
        # read its authenticated account snapshot, but before its write locks it.
        self.repository.update_user(self.owner_id, name="Current Name", email="updated@example.com")
        with patch.object(self.repository, "authenticated_user", return_value=self.owner):
            stale = self.client.patch("/api/auth/me", json={"name": "Stale Name", "email": "first@example.com"}, headers=self.headers)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.json()["error"]["code"], "PROFILE_CHANGED")
        self.assertEqual(self.repository.get_user(self.owner_id)["email"], "updated@example.com")
        self.assertEqual(self.repository.get_user(self.owner_id)["name"], "Current Name")
        self.assertEqual(self.client.get("/api/auth/me", headers=self.headers).status_code, 200)
        self.assertEqual(self.client.patch("/api/auth/me", json={"name": "Fresh Name", "email": "first@example.com"}, headers=self.headers).status_code, 403)

    def test_oversized_and_short_new_passwords_fail_without_consuming_recovery(self):
        codes = self.codes()
        for password in ("short", "é" * 40):
            self.assertEqual(self.recover(codes[0], password=password).status_code, 422)
            self.assertEqual(self.client.post("/api/auth/change-password", json={"currentPassword": "profile-test-password", "newPassword": password}, headers=self.headers).status_code, 422)
        self.assertEqual(self.repository.recovery_codes_remaining(self.owner_id), 8)
        self.assertEqual(self.client.post("/api/auth/recovery-codes", json={"currentPassword": "é" * 40}, headers=self.headers).status_code, 422)

    def test_recovery_rate_limit_has_retry_header_and_no_state_changes(self):
        for _ in range(5):
            self.assertEqual(self.recover("invalid-code").status_code, 400)
        blocked = self.recover("invalid-code")
        self.assertEqual(blocked.status_code, 429)
        self.assertGreater(int(blocked.headers["Retry-After"]), 0)
        self.assertEqual(self.repository.get_user(self.owner_id)["passwordHash"], self.password_hash)

    def test_concurrent_recovery_code_consumption_has_exactly_one_winner(self):
        codes = self.codes()
        barrier = threading.Barrier(2)
        new_hash = hash_password("concurrency-recovered-password")
        def attempt():
            barrier.wait(timeout=10)
            return self.repository.recover_password("first@example.com", recovery_digest(codes[0]), new_hash)
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: attempt(), range(2)))
        self.assertEqual(sorted(outcomes), [False, True])
        self.assertEqual(self.repository.recovery_codes_remaining(self.owner_id), 7)
        self.assertEqual(self.repository.get_user(self.owner_id)["authVersion"], 1)

    def test_stale_sensitive_operations_cannot_resurrect_sessions_after_recovery(self):
        codes = self.codes()
        self.assertTrue(self.repository.recover_password("first@example.com", recovery_digest(codes[0]), hash_password("recovered-password")))
        self.assertIsNone(issue_session(self.repository, self.owner))
        self.assertFalse(self.repository.replace_recovery_codes(self.owner_id, [recovery_digest(codes[1])],
                         expected_password_hash=self.owner["passwordHash"], expected_auth_version=0))
        self.assertIsNone(self.repository.change_password(self.owner_id, "must-not-win", expected_password_hash=self.owner["passwordHash"],
                         expected_auth_version=0, session_id="stale-session", expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
        self.assertTrue(verify_password("recovered-password", self.repository.get_user(self.owner_id)["passwordHash"]))


class AccountMigrationTests(unittest.TestCase):
    def test_existing_user_survives_additive_migration_and_repeat_upgrade(self):
        with tempfile.TemporaryDirectory() as folder:
            url = "sqlite:///" + (Path(folder) / "upgrade.sqlite").as_posix()
            engine = database_engine(url, allow_sqlite=True)
            config = Config(str(SERVER_ROOT / "alembic.ini"))
            with engine.begin() as connection:
                config.attributes["connection"] = connection
                command.upgrade(config, "0002_legacy_payment_ids")
                connection.execute(text("INSERT INTO users (id, name, email, password_hash, role, created_at) VALUES (:id, :name, :email, :hash, :role, :created)"),
                                   {"id": "existing-user", "name": "Existing", "email": "existing@example.com", "hash": "preserved-password-hash",
                                    "role": "merchant", "created": datetime.now(timezone.utc)})
            engine.dispose()
            upgrade_database(url, allow_sqlite=True)
            upgrade_database(url, allow_sqlite=True)
            repository = Repository(url, allow_sqlite=True)
            try:
                repository.check_schema()
                user = repository.get_user("existing-user")
                self.assertEqual(user["passwordHash"], "preserved-password-hash")
                self.assertEqual(user["authVersion"], 0)
                self.assertEqual(repository.recovery_codes_remaining(user["_id"]), 0)
            finally:
                repository.close()


if __name__ == "__main__":
    unittest.main()
