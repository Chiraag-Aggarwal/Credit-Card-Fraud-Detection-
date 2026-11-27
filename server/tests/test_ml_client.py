import os
import unittest
from unittest.mock import patch

import httpx

from app.ml_client import request_model


class ModelClientTests(unittest.TestCase):
    def setUp(self):
        self.clock = 100.0
        self.env = patch.dict(os.environ, {"ML_SERVICE_URL": "https://model.example.com",
                                          "ML_API_KEY": "private-model-key", "ML_TIMEOUT_MS": "60000"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def sleep(self, delay):
        self.clock += delay

    def response(self, status, data=None):
        return httpx.Response(status, json=data, request=httpx.Request("GET", "https://model.example.com/model-info"))

    def test_cold_start_recovers_without_changing_prediction(self):
        result = {"fraud_probability": 0.7, "model_version": "xgboost-v1"}
        with patch("app.ml_client.httpx.request", side_effect=[self.response(503), self.response(502), self.response(200, result)]) as send, patch("app.ml_client.time.sleep", side_effect=self.sleep), patch("app.ml_client.time.monotonic", side_effect=lambda: self.clock):
            self.assertEqual(request_model("POST", "/predict", {"Amount": 10}), result)
        self.assertEqual(send.call_count, 3)
        self.assertTrue(all(call.kwargs["json"] == {"Amount": 10} for call in send.call_args_list))
        self.assertTrue(all(call.kwargs["follow_redirects"] is False for call in send.call_args_list))

    def test_invalid_key_is_not_retried_or_exposed(self):
        with patch("app.ml_client.httpx.request", return_value=self.response(401)) as send, patch("app.ml_client.time.sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "^The ML service is unavailable\\.$"):
                request_model("GET", "/model-info")
        self.assertEqual(send.call_count, 1)
        sleep.assert_not_called()

    def test_unavailable_model_stops_at_budget(self):
        with patch.dict(os.environ, {"ML_TIMEOUT_MS": "5000"}), patch("app.ml_client.httpx.request", return_value=self.response(503)) as send, patch("app.ml_client.time.sleep", side_effect=self.sleep), patch("app.ml_client.time.monotonic", side_effect=lambda: self.clock):
            with self.assertRaises(RuntimeError):
                request_model("GET", "/model-info")
        self.assertLessEqual(send.call_count, 3)
        self.assertEqual(self.clock, 105.0)

    def test_transport_timeout_can_recover(self):
        with patch("app.ml_client.httpx.request", side_effect=[httpx.ConnectTimeout("private details"), self.response(200, {"model_version": "xgboost-v1"})]), patch("app.ml_client.time.sleep", side_effect=self.sleep), patch("app.ml_client.time.monotonic", side_effect=lambda: self.clock):
            self.assertEqual(request_model("GET", "/model-info")["model_version"], "xgboost-v1")

    def test_no_arbitrary_writes_or_unbounded_configuration(self):
        with patch("app.ml_client.httpx.request") as send:
            with self.assertRaises(RuntimeError):
                request_model("POST", "/payments")
            for invalid in ("nan", "inf", "0", "-1", "76000", "bad"):
                with patch.dict(os.environ, {"ML_TIMEOUT_MS": invalid}), self.assertRaises(RuntimeError):
                    request_model("GET", "/model-info")
        send.assert_not_called()


if __name__ == "__main__":
    unittest.main()
