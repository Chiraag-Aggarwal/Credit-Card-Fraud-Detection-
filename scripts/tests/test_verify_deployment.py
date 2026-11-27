import argparse
import importlib.util
from pathlib import Path
import sys
import unittest


spec = importlib.util.spec_from_file_location("verify_deployment", Path(__file__).resolve().parents[1] / "verify_deployment.py")
verify = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = verify
spec.loader.exec_module(verify)


class DeploymentVerificationTests(unittest.TestCase):
    def test_origins_reject_secrets_and_paths_without_echoing_input(self):
        for value in ("https://user:secret@example.com", "https://example.com/?key=secret",
                      "http://example.com", "https://example.com/api", "https://example.com:bad",
                      "https://user:secret@[invalid"):
            with self.subTest(value=value):
                with self.assertRaises(argparse.ArgumentTypeError) as result:
                    verify.origin(value)
                self.assertNotIn("secret", str(result.exception))
        self.assertEqual(verify.origin("https://example.com/"), "https://example.com")

    def test_frontend_detects_missing_rewrite_and_wrong_api_build(self):
        html = b'<html><div id="root"></div><script type="module" src="/assets/main.js"></script></html>'
        def fetcher(url):
            if url.endswith(".js"):
                return verify.Response(200, {"content-type": "text/javascript"}, b'https://wrong.example.com')
            return verify.Response(200, {"content-type": "text/html"}, html)
        with self.assertRaisesRegex(verify.CheckFailure, "expected real API"):
            verify.check_frontend("https://site.example.com", "https://api.example.com", fetcher)
        with self.assertRaisesRegex(verify.CheckFailure, "HTTP 200"):
            verify.check_frontend("https://site.example.com", "https://api.example.com",
                                  lambda _: verify.Response(404, {}, b"missing"))

    def test_frontend_never_follows_external_script(self):
        calls = []
        def fetcher(url):
            calls.append(url)
            return verify.Response(200, {"content-type": "text/html"},
                                   b'<div id="root"></div><script type="module" src="https://other.example/x.js"></script>')
        with self.assertRaisesRegex(verify.CheckFailure, "frontend origin"):
            verify.check_frontend("https://site.example.com", "https://api.example.com", fetcher)
        self.assertTrue(all(url.startswith("https://site.example.com/") for url in calls))

    def test_frontend_finds_real_configuration_in_split_bundle(self):
        def fetcher(url):
            if url.endswith("main.js"):
                return verify.Response(200, {"content-type": "text/javascript"}, b'import {client} from "./client.js";')
            if url.endswith("client.js"):
                return verify.Response(200, {"content-type": "text/javascript"}, b'const baseURL="https://api.example.com";')
            return verify.Response(200, {"content-type": "text/html"},
                                   b'<div id="root"></div><script type="module" src="/assets/main.js"></script>')
        self.assertIn("expected API", verify.check_frontend("https://site.example.com", "https://api.example.com", fetcher))

    def test_model_requires_loaded_artifact_and_private_boundary(self):
        def fetcher(url):
            if url.endswith("/health"):
                return verify.Response(200, {}, b'{"model_loaded":true,"model_version":"xgboost-v1"}')
            return verify.Response(200, {}, b'{}')
        with self.assertRaisesRegex(verify.CheckFailure, "shared key"):
            verify.check_ml("https://model.example.com", fetcher)

    def test_api_rejects_permissive_cors(self):
        def fetcher(url, **kwargs):
            if url.endswith("/health"):
                return verify.Response(200, {}, b'{"status":"ok","database":true}')
            if url.endswith("/me"):
                return verify.Response(401, {}, b'{"error":{"code":"UNAUTHORIZED"}}')
            return verify.Response(200, {"access-control-allow-origin": kwargs["headers"]["Origin"]}, b'')
        with self.assertRaisesRegex(verify.CheckFailure, "unexpected browser origin"):
            verify.check_api("https://api.example.com", "https://site.example.com", fetcher)

    def test_transient_startup_retries_but_wrong_configuration_does_not(self):
        elapsed = [0]
        attempts = []
        def check(_):
            attempts.append(1)
            if len(attempts) == 1:
                raise verify.CheckFailure("Starting.", retryable=True)
            return "Ready."
        result = verify.run_check(check, 5, clock=lambda: elapsed[0], sleep=lambda seconds: elapsed.__setitem__(0, elapsed[0] + seconds))
        self.assertEqual(result, (True, "Ready."))
        self.assertEqual(len(attempts), 2)
        self.assertEqual(elapsed[0], 2)
        result = verify.run_check(lambda _: (_ for _ in ()).throw(verify.CheckFailure("Wrong configuration.")), 5,
                                  sleep=lambda _: self.fail("A configuration failure must not retry."))
        self.assertEqual(result, (False, "Wrong configuration."))

    def test_unexpected_exception_does_not_print_its_secret(self):
        result = verify.run_check(lambda _: (_ for _ in ()).throw(RuntimeError("secret-password")), 5)
        self.assertEqual(result, (False, "Deployment check could not complete."))


if __name__ == "__main__":
    unittest.main()
