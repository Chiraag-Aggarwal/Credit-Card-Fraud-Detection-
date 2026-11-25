"""Deployment API contracts with real storage and mocked payment/model providers."""

from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import os
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt

from app.security import issue_token
from tests.api_test_support import ApiTestCase, PAYMENT_SECRET, TEST_SECRET, WEBHOOK_SECRET


PREDICTION = {"fraud_probability": 0.93, "risk_label": "HIGH", "is_fraud": True, "threshold": 0.5, "model_version": "fixture"}
FEATURES = {"Time": 1, **{f"V{i}": 0 for i in range(1, 29)}, "Amount": 19.99}


def provider_response(payload):
    return httpx.Response(200, json=payload, request=httpx.Request("POST", "https://provider.invalid"))


class DeploymentApiTests(ApiTestCase):
    def checkout(self, *, order_id="order_fixture", amount=1999):
        with patch.dict(os.environ, {"PAYMENTS_ENABLED": "true"}), patch("app.main.httpx.post", return_value=provider_response({"id": order_id, "amount": amount, "currency": "INR"})) as provider:
            response = self.client.post("/api/payments/checkout-session", json={"amount": amount / 100, "currency": "inr", "mode": "normal"}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(provider.call_args.kwargs["json"]["amount"], amount)
        query = parse_qs(urlsplit(response.json()["url"]).query)
        return {key: values[0] for key, values in query.items()}

    def verify_body(self, checkout, *, payment_id="pay_fixture"):
        order_id = checkout["order_id"]
        return {"sessionToken": checkout["session_token"], "razorpay_order_id": order_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": hmac.new(PAYMENT_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()}

    def stored_checkout(self, *, order_id="order_fixture"):
        now = datetime.now(timezone.utc)
        return self.repository.create_checkout({"razorpayOrderId": order_id, "merchantId": self.owner_id,
                                               "amountPaise": 1999, "currency": "inr", "mode": "normal", "paymentMode": "test",
                                               "expiresAt": now + timedelta(days=90), "createdAt": now})

    def webhook(self, payment, *, event_id="event_fixture", corrupt_signature=False):
        raw = json.dumps({"event": "payment.captured", "payload": {"payment": {"entity": payment}}}, separators=(",", ":")).encode()
        signature = hmac.new(WEBHOOK_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        return self.client.post("/api/webhooks/razorpay", content=raw, headers={
            "Content-Type": "application/json", "X-Razorpay-Signature": "0" * 64 if corrupt_signature else signature,
            "X-Razorpay-Event-Id": event_id,
        })

    def payment(self, **changes):
        return {"id": "pay_fixture", "order_id": "order_fixture", "status": "captured", "amount": 1999, "currency": "INR", **changes}

    def test_registration_login_preserve_password_whitespace_and_reject_duplicates(self):
        password = "  significant-spaces  "
        response = self.client.post("/api/auth/register", json={"name": "  New User  ", "email": "NEW@EXAMPLE.COM", "password": password})
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["user"]["name"], "New User")
        self.assertNotIn("passwordHash", response.json()["user"])
        user_id = response.json()["user"]["id"]
        login = self.client.post("/api/auth/login", json={"email": "new@example.com", "password": password})
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.json()["user"]["id"], user_id)
        self.assertEqual(self.client.post("/api/auth/login", json={"email": "new@example.com", "password": password.strip()}).status_code, 401)
        self.assertEqual(self.client.post("/api/auth/register", json={"name": "Duplicate", "email": "new@example.com", "password": password}).status_code, 409)
        self.assertEqual(self.client.post("/api/auth/register", json={"name": "Bytes", "email": "bytes@example.com", "password": "é" * 40}).status_code, 422)

    def test_expired_and_checkout_tokens_cannot_authorize_account_access(self):
        now = datetime.now(timezone.utc)
        expired = jwt.encode({"sub": self.owner_id, "type": "access", "aud": "fraud-dashboard", "iss": "fraud-api",
                              "iat": now - timedelta(days=2), "exp": now - timedelta(days=1)}, TEST_SECRET, algorithm="HS256")
        self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + expired}).status_code, 401)
        checkout = self.checkout()
        self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + checkout["session_token"]}).status_code, 401)
        missing = issue_token("missing-user", "merchant")
        self.assertEqual(self.client.get("/api/auth/me", headers={"Authorization": "Bearer " + missing}).status_code, 401)

    def test_transaction_ownership_filters_stats_and_review_clear_alerts(self):
        old = self.transaction(createdAt=datetime.now(timezone.utc) - timedelta(days=2), riskLabel="LOW", isFlagged=False, fraudProbability=0.1)
        current = self.transaction()
        foreign = self.transaction(merchantId=self.other_id)
        rows = self.client.get("/api/transactions?page=2&limit=1", headers=self.headers).json()
        self.assertEqual(rows["total"], 2)
        self.assertEqual(rows["items"][0]["id"], old["_id"])
        filtered = self.client.get("/api/transactions?riskLabel=HIGH&flagged=true", headers=self.headers).json()
        self.assertEqual([row["id"] for row in filtered["items"]], [current["_id"]])
        self.assertEqual(self.client.patch(f"/api/transactions/{foreign['_id']}/review", json={"decision": "legit"}, headers=self.headers).status_code, 404)
        self.assertEqual(self.client.get(f"/api/transactions/{foreign['_id']}/explanation", headers=self.headers).status_code, 404)
        summary = self.client.get("/api/transactions/stats", headers=self.headers).json()
        self.assertEqual(summary["total"], 2)
        self.assertEqual(summary["flagged"], 1)
        self.assertEqual(len(summary["series24h"]), 24)
        self.assertEqual(sum(row["count"] for row in self.client.get("/api/transactions/score-histogram", headers=self.headers).json()["bins"]), 2)
        reviewed = self.client.patch(f"/api/transactions/{current['_id']}/review", json={"decision": "legit"}, headers=self.headers)
        self.assertEqual(reviewed.status_code, 200)
        self.assertFalse(reviewed.json()["isFlagged"])
        self.assertEqual(reviewed.json()["fraudProbability"], 0.95)
        self.assertEqual(self.client.get("/api/alerts/unread-count", headers=self.headers).json()["count"], 0)

    def test_invalid_date_filters_and_pagination_fail_before_query(self):
        for query in ("from=invalid", "from=2026-12-01&to=2026-11-01", "page=0", "limit=101", "riskLabel=UNKNOWN"):
            with self.subTest(query=query):
                self.assertEqual(self.client.get("/api/transactions?" + query, headers=self.headers).status_code, 422)
        self.assertEqual(self.client.get("/api/transactions").status_code, 401)

    def test_simulation_uses_one_batch_request_and_persists_scored_rows(self):
        with patch("app.main.ml_call", return_value=[PREDICTION] * 3) as model:
            response = self.client.post("/api/transactions/simulate", json={"count": 3, "mode": "fraud"}, headers=self.headers)
        self.assertEqual(response.status_code, 201)
        model.assert_called_once()
        self.assertEqual(model.call_args.args[:2], ("POST", "/predict/batch"))
        self.assertEqual(len(model.call_args.args[2]), 3)
        self.assertEqual(response.json()["created"], 3)
        self.assertTrue(all(row["scoringStatus"] == "scored" for row in response.json()["items"]))
        self.assertEqual(self.repository.list_transactions(self.owner_id)[1], 3)

    def test_simulation_model_outage_persists_one_batch_as_pending_review(self):
        with patch("app.main.ml_call", side_effect=RuntimeError("fixture outage")) as model:
            response = self.client.post("/api/transactions/simulate", json={"count": 3, "mode": "random"}, headers=self.headers)
        self.assertEqual(response.status_code, 201)
        model.assert_called_once()
        self.assertTrue(all(row["scoringStatus"] == "pending_review" and row["scoringReason"] == "model_unavailable" and row["fraudProbability"] is None for row in response.json()["items"]))
        self.assertEqual(self.repository.unread_count(self.owner_id), 3)

    def test_batch_predictions_validate_features_and_provider_responses(self):
        with patch("app.main.ml_call", return_value=[PREDICTION]) as model:
            self.assertEqual(self.client.post("/api/predictions/batch", json={"transactions": []}, headers=self.headers).status_code, 422)
            self.assertEqual(self.client.post("/api/predictions/batch", json={"transactions": [{"Amount": 1}]}, headers=self.headers).status_code, 422)
            model.assert_not_called()
            response = self.client.post("/api/predictions/batch", json={"transactions": [FEATURES]}, headers=self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["items"][0]["fraudProbability"], 0.93)
        with patch("app.main.ml_call", return_value=[{**PREDICTION, "fraud_probability": 1.5}]):
            self.assertEqual(self.client.post("/api/predictions/batch", json={"transactions": [FEATURES]}, headers=self.headers).status_code, 503)
        self.assertEqual(self.repository.list_transactions(self.owner_id)[1], 0)

    def test_disabled_and_unapproved_live_payments_do_not_contact_provider(self):
        with patch("app.main.httpx.post") as provider:
            status = self.client.get("/api/payments/status", headers=self.headers).json()
            self.assertEqual(status["mode"], "disabled")
            response = self.client.post("/api/payments/checkout-session", json={"amount": 19.99, "mode": "normal"}, headers=self.headers)
            self.assertEqual(response.status_code, 503)
            with patch.dict(os.environ, {"PAYMENTS_ENABLED": "true", "RAZORPAY_KEY_ID": "rzp_live_fixture"}):
                self.assertFalse(self.client.get("/api/payments/status", headers=self.headers).json()["enabled"])
                self.assertEqual(self.client.post("/api/payments/checkout-session", json={"amount": 19.99, "mode": "normal"}, headers=self.headers).status_code, 503)
            provider.assert_not_called()
        with patch.dict(os.environ, {"PAYMENTS_ENABLED": "true"}):
            self.assertEqual(self.client.get("/api/payments/status", headers=self.headers).json()["mode"], "test")

    def test_checkout_rejects_demo_scoring_bad_precision_and_bad_provider_order(self):
        with patch.dict(os.environ, {"PAYMENTS_ENABLED": "true"}), patch("app.main.httpx.post") as provider:
            for body in ({"amount": 19.99, "mode": "fraud-demo"}, {"amount": 19.999, "mode": "normal"}, {"amount": 19.99, "mode": "normal", "currency": "usd"}):
                self.assertEqual(self.client.post("/api/payments/checkout-session", json=body, headers=self.headers).status_code, 422)
            provider.assert_not_called()
            provider.return_value = provider_response({"id": "order_fixture", "amount": 1, "currency": "INR"})
            self.assertEqual(self.client.post("/api/payments/checkout-session", json={"amount": 19.99, "mode": "normal"}, headers=self.headers).status_code, 502)
        self.assertIsNone(self.repository.get_checkout("order_fixture"))

    def test_verified_payment_is_idempotent_unscored_and_never_calls_model(self):
        checkout = self.checkout()
        self.assertEqual(checkout["mode"], "test")
        body = self.verify_body(checkout)
        with patch("app.main.httpx.get", return_value=provider_response(self.payment())), patch("app.main.ml_call") as model:
            first = self.client.post("/api/payments/verify", json=body)
            again = self.client.post("/api/payments/verify", json=body)
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(again.status_code, 200)
        model.assert_not_called()
        transaction = first.json()["transaction"]
        self.assertEqual(transaction["id"], again.json()["transaction"]["id"])
        self.assertEqual(transaction["displayAmount"], 19.99)
        self.assertEqual(transaction["paymentMode"], "test")
        self.assertEqual(transaction["riskLabel"], "UNSCORED")
        self.assertEqual(transaction["scoringReason"], "unsupported_payment_features")
        self.assertIsNone(transaction["fraudProbability"])
        self.assertEqual(self.repository.list_transactions(self.owner_id)[1], 1)
        self.assertEqual(self.client.get(f"/api/transactions/{transaction['id']}/explanation", headers=self.headers).status_code, 409)

    def test_verification_rejects_bad_signatures_expiry_amount_and_provider_identity(self):
        checkout = self.checkout()
        body = self.verify_body(checkout)
        with patch("app.main.httpx.get") as provider:
            self.assertEqual(self.client.post("/api/payments/verify", json={**body, "razorpay_signature": "0" * 64}).status_code, 400)
            payload = jwt.decode(checkout["session_token"], TEST_SECRET, algorithms=["HS256"], audience="fraud-checkout")
            payload["exp"] = datetime.now(timezone.utc) - timedelta(seconds=1)
            expired = jwt.encode(payload, TEST_SECRET, algorithm="HS256")
            self.assertEqual(self.client.post("/api/payments/verify", json={**body, "sessionToken": expired}).status_code, 401)
            provider.assert_not_called()
            for payment, status in ((self.payment(id="pay_other"), 400), (self.payment(amount=2000), 409), (self.payment(currency="USD"), 409), (self.payment(status="authorized"), 409)):
                provider.return_value = provider_response(payment)
                self.assertEqual(self.client.post("/api/payments/verify", json=body).status_code, status)
        self.assertEqual(self.repository.list_transactions(self.owner_id)[1], 0)

    def test_webhook_duplicate_records_one_payment_and_completed_receipt(self):
        self.stored_checkout()
        with patch("app.main.ml_call") as model:
            first, again = self.webhook(self.payment()), self.webhook(self.payment())
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(again.status_code, 200)
        model.assert_not_called()
        self.assertEqual(self.repository.list_transactions(self.owner_id)[1], 1)
        receipt = self.repository.get_webhook("event_fixture")
        self.assertEqual(receipt["status"], "completed")
        self.assertEqual(receipt["transactionId"], self.repository.get_transaction_by_payment("pay_fixture")["_id"])

    def test_webhook_unknown_order_remains_pending_then_retries_successfully(self):
        first = self.webhook(self.payment())
        self.assertEqual(first.status_code, 503)
        self.assertEqual(first.json()["error"]["code"], "PAYMENT_RECONCILIATION_REQUIRED")
        self.assertEqual(self.repository.get_webhook("event_fixture")["status"], "received")
        self.stored_checkout()
        again = self.webhook(self.payment())
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(self.repository.get_webhook("event_fixture")["status"], "completed")

    def test_webhook_rejects_invalid_signature_and_retries_mismatched_amount(self):
        self.stored_checkout()
        self.assertEqual(self.webhook(self.payment(), corrupt_signature=True).status_code, 400)
        self.assertIsNone(self.repository.get_webhook("event_fixture"))
        self.assertEqual(self.webhook(self.payment(amount=9999)).status_code, 503)
        self.assertEqual(self.repository.get_webhook("event_fixture")["status"], "received")
        self.assertEqual(self.repository.list_transactions(self.owner_id)[1], 0)

    def test_health_reports_database_failure(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok", "database": True})
        with patch.object(self.repository, "ping", side_effect=RuntimeError("offline")):
            response = self.client.get("/health")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "unavailable", "database": False})

    def test_oversized_body_is_rejected_before_parsing_or_provider_calls(self):
        response = self.client.post("/api/auth/register", content=b"x" * 530_000, headers={"Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json()["error"]["code"], "PAYLOAD_TOO_LARGE")
