"""Profile API regression tests against the SQL domain repository.

Run from server/: python -m unittest discover -s tests -v
"""

import unittest
from tests.api_test_support import ApiTestCase


class ProfileTests(ApiTestCase):

    def test_update_is_scoped_to_authenticated_user_and_hides_private_fields(self):
        response = self.client.patch("/api/auth/me", json={"name": "  Updated Name  ", "email": "NEW@EXAMPLE.COM", "currentPassword": "profile-test-password"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"user": {"id": str(self.owner_id), "name": "Updated Name", "email": "new@example.com", "role": "merchant"}})
        self.assertEqual(self.repository.get_user(self.other_id)["name"], "Second User")
        self.assertEqual(self.repository.get_user(self.owner_id)["passwordHash"], self.password_hash)

    def test_missing_and_invalid_token_are_rejected(self):
        body = {"name": "Changed", "email": "changed@example.com"}
        self.assertEqual(self.client.patch("/api/auth/me", json=body).status_code, 401)
        self.assertEqual(self.client.patch("/api/auth/me", json=body, headers={"Authorization": "Bearer invalid"}).status_code, 401)

    def test_validation_and_privileged_fields_are_rejected(self):
        invalid_bodies = [
            {"name": "   ", "email": "valid@example.com"},
            {"name": "A" * 121, "email": "valid@example.com"},
            {"name": "Valid", "email": "not-an-email"},
            {"name": "Valid"},
            {"name": "Valid", "email": "valid@example.com", "role": "admin"},
            {"name": "Valid", "email": "valid@example.com", "id": str(self.other_id)},
            {"name": "Valid", "email": "valid@example.com", "password": "changed-password"},
        ]
        for body in invalid_bodies:
            with self.subTest(body=body):
                response = self.client.patch("/api/auth/me", json=body, headers=self.headers)
                self.assertEqual(response.status_code, 422)
        self.assertEqual(self.repository.get_user(self.owner_id)["email"], "first@example.com")

    def test_duplicate_email_returns_conflict_without_changing_profile(self):
        response = self.client.patch("/api/auth/me", json={"name": "Changed", "email": "SECOND@EXAMPLE.COM", "currentPassword": "profile-test-password"}, headers=self.headers)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["error"]["code"], "EMAIL_EXISTS")
        self.assertEqual(self.repository.get_user(self.owner_id)["name"], "First User")

    def test_unchanged_email_is_allowed(self):
        response = self.client.patch("/api/auth/me", json={"name": "New Name", "email": "first@example.com"}, headers=self.headers)
        self.assertEqual(response.status_code, 200)

    def test_existing_token_and_new_email_login_keep_the_same_identity(self):
        self.client.patch("/api/auth/me", json={"name": "New Name", "email": "new@example.com", "currentPassword": "profile-test-password"}, headers=self.headers)
        current = self.client.get("/api/auth/me", headers=self.headers)
        self.assertEqual(current.status_code, 200)
        self.assertEqual(current.json()["user"]["id"], str(self.owner_id))
        login = self.client.post("/api/auth/login", json={"email": "new@example.com", "password": "profile-test-password"})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["user"]["id"], str(self.owner_id))
        previous_login = self.client.post("/api/auth/login", json={"email": "first@example.com", "password": "profile-test-password"})
        self.assertEqual(previous_login.status_code, 401)


if __name__ == "__main__":
    unittest.main()
