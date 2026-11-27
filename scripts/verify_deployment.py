"""Read-only public deployment checks. No account, token, or database key needed."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from html.parser import HTMLParser
import json
import re
import socket
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


DEFAULT_FRONTEND = "https://credit-card-fraud-detection-demo.onrender.com"
DEFAULT_API = "https://credit-card-fraud-api-lacc.onrender.com"
DEFAULT_ML = "https://credit-card-fraud-detection-75bx.onrender.com"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class CheckFailure(Exception):
    """Messages are fixed descriptions, never raw server bodies or exceptions."""

    def __init__(self, message, *, retryable=False):
        super().__init__(message)
        self.retryable = retryable


def origin(value):
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError:
        raise argparse.ArgumentTypeError("Use a valid HTTPS origin.") from None
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in {"", "/"}):
        raise argparse.ArgumentTypeError("Use a public HTTPS origin without credentials or a path.")
    return value.rstrip("/")


class SameOriginRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urlsplit(req.full_url), urlsplit(newurl)
        if (old.scheme, old.netloc) != (new.scheme, new.netloc):
            raise CheckFailure("Unexpected cross-origin redirect.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


@dataclass
class Response:
    status: int
    headers: dict
    body: bytes

    def json(self):
        try:
            data = json.loads(self.body)
        except (ValueError, UnicodeDecodeError):
            raise CheckFailure("Expected a JSON API response.", retryable=True) from None
        if not isinstance(data, dict):
            raise CheckFailure("Expected a JSON object.")
        return data


def fetch(url, *, method="GET", headers=None, timeout=20):
    request = Request(url, method=method, headers={
        "User-Agent": "FraudDashboard-DeploymentCheck/1.0", **(headers or {}),
    })
    try:
        response = build_opener(SameOriginRedirect()).open(request, timeout=timeout)
    except HTTPError as error:
        response = error  # Status checks intentionally exercise 401 and CORS rejection.
    except (URLError, TimeoutError, socket.timeout, OSError):
        raise CheckFailure("Service did not respond within the request deadline.", retryable=True) from None
    try:
        with response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise CheckFailure("Response exceeded the expected size.")
            result = Response(response.status, {key.lower(): value for key, value in response.headers.items()}, body)
    except (URLError, TimeoutError, socket.timeout, OSError):
        raise CheckFailure("Service response could not be read within the request deadline.", retryable=True) from None
    if result.status in {429, 502, 503, 504}:
        raise CheckFailure("Service is starting, busy, or unavailable.", retryable=True)
    return result


def require(condition, message):
    if not condition:
        raise CheckFailure(message)


class AppHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.has_root = False
        self.module_source = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "div" and attrs.get("id") == "root":
            self.has_root = True
        if tag == "script" and attrs.get("type") == "module" and attrs.get("src"):
            self.module_source = attrs["src"]


def check_frontend(frontend, api, fetcher):
    module_source = None
    for path in ("/login", "/register", "/recover", "/flagged", "/profile"):
        response = fetcher(frontend + path)
        require(response.status == 200, "A frontend route does not return HTTP 200.")
        require("text/html" in response.headers.get("content-type", ""), "A frontend route does not return HTML.")
        parser = AppHTML()
        parser.feed(response.body.decode("utf-8", errors="replace"))
        require(parser.has_root and parser.module_source, "A frontend route does not load the React application.")
        if module_source is None:
            module_source = parser.module_source
        require(parser.module_source == module_source, "Frontend routes serve different application builds.")
    # Vite can put the Axios client in a shared module instead of the entry file.
    # Inspect a bounded import graph; never execute downloaded JavaScript.
    pending = [urljoin(frontend + "/", module_source)]
    visited = set()
    found_api = False
    while pending and len(visited) < 12:
        asset_url = pending.pop(0)
        if asset_url in visited:
            continue
        require(urlsplit(asset_url).netloc == urlsplit(frontend).netloc
                and urlsplit(asset_url).scheme == "https", "Application script must come from the frontend origin.")
        visited.add(asset_url)
        asset = fetcher(asset_url)
        require(asset.status == 200, "An application JavaScript asset could not be loaded.")
        require("javascript" in asset.headers.get("content-type", ""), "The application script has the wrong content type.")
        if api.encode() in asset.body:
            found_api = True
            break
        source = asset.body.decode("utf-8", errors="replace")
        imports = re.findall(r"\b(?:from|import)\s*\(?\s*[\"']([^\"']+\.js)[\"']", source)
        pending.extend(urljoin(asset_url, path) for path in imports)
    require(found_api, "The frontend build does not contain the expected real API origin.")
    return "Routes and JavaScript load with the expected API configuration."


def check_api(api, frontend, fetcher):
    health = fetcher(api + "/health")
    require(health.status == 200, "API health does not return HTTP 200.")
    data = health.json()
    require(data.get("status") == "ok" and data.get("database") is True, "API database health is not ready.")
    anonymous = fetcher(api + "/api/auth/me")
    require(anonymous.status == 401 and anonymous.json().get("error", {}).get("code") == "UNAUTHORIZED",
            "The account endpoint did not reject an anonymous request.")
    cors = fetcher(api + "/api/auth/login", method="OPTIONS", headers={
        "Origin": frontend, "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    require(cors.status == 200 and cors.headers.get("access-control-allow-origin") == frontend,
            "The API does not allow the configured frontend origin.")
    foreign = fetcher(api + "/api/auth/login", method="OPTIONS", headers={
        "Origin": "https://untrusted.invalid", "Access-Control-Request-Method": "POST",
    })
    require(not foreign.headers.get("access-control-allow-origin"), "The API allowed an unexpected browser origin.")
    return "PostgreSQL health, authentication boundary, and CORS passed."


def check_ml(ml, fetcher):
    health = fetcher(ml + "/health")
    require(health.status == 200, "Model health does not return HTTP 200.")
    data = health.json()
    require(data.get("model_loaded") is True and bool(data.get("model_version")), "The trained model is not loaded.")
    protected = fetcher(ml + "/model-info")
    require(protected.status == 401, "The model endpoint did not require its shared key.")
    return "Trained model loaded; private endpoint requires authentication."


def run_check(check, max_wait, *, clock=time.monotonic, sleep=time.sleep):
    deadline = clock() + max_wait

    def bounded_fetch(url, **kwargs):
        remaining = deadline - clock()
        if remaining <= 0:
            raise CheckFailure("Readiness deadline exceeded.")
        return fetch(url, timeout=min(20, remaining), **kwargs)

    while True:
        try:
            return True, check(bounded_fetch)
        except CheckFailure as error:
            remaining = deadline - clock()
            if not error.retryable or remaining <= 2:
                return False, str(error)
            sleep(min(2, remaining))
        except Exception:
            return False, "Deployment check could not complete."


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend", type=origin, default=DEFAULT_FRONTEND)
    parser.add_argument("--api", type=origin, default=DEFAULT_API)
    parser.add_argument("--ml", type=origin, default=DEFAULT_ML)
    parser.add_argument("--max-wait", type=int, default=120, choices=range(5, 181), metavar="5..180")
    args = parser.parse_args(argv)
    checks = (
        ("Frontend", lambda fetcher: check_frontend(args.frontend, args.api, fetcher)),
        ("API", lambda fetcher: check_api(args.api, args.frontend, fetcher)),
        ("Model", lambda fetcher: check_ml(args.ml, fetcher)),
    )
    print("Checking public endpoints; sleeping free services may need time to start.", flush=True)
    passed = True
    with ThreadPoolExecutor(max_workers=3) as pool:
        pending = [(label, pool.submit(run_check, check, args.max_wait)) for label, check in checks]
        for label, future in pending:
            success, message = future.result()
            passed = passed and success
            print(f"{'PASS' if success else 'FAIL'} {label}: {message}", flush=True)
    print("No accounts, records, secrets, or payments were created or changed.")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
