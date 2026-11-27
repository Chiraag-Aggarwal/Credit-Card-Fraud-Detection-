# Verification

## Automated checks

Use Node.js 22 and Python 3.12. CI runs the frontend, API, model and deployment-tool checks independently.

From the repository root, the read-only deployment checker has its own offline tests:

```powershell
python -m unittest discover -s scripts/tests -v
```

From client/:

```powershell
npm ci
npm test
npm run lint
$env:VITE_USE_MOCK = 'false'
$env:VITE_API_URL = 'https://your-api.onrender.com'
npm run build
```

A real production build requires an absolute HTTPS API origin (HTTP is accepted only for local development hosts). Explicit mock builds may omit it. Client tests cover preferences, storage failures, Hindi errors, profile edits, request cleanup, date filters, checkout availability and token handling, separate auth modes, and password byte limits.

From server/:

```powershell
python -m pip install --upgrade pip==26.2
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

Set TEST_DATABASE_URL to a disposable PostgreSQL database for the PostgreSQL tests and API integration tests. Each suite creates and drops only its own random test schema. Without the variable, API tests use temporary SQLite and the PostgreSQL variants are skipped. Deployed startup accepts PostgreSQL only.

Tests cover schema migration, persistence, IDs, decimal money, uniqueness, user isolation, authentication/profile validation, token purpose, stats/filters/pagination, review audits, model outages and batch simulation. Razorpay requests are mocked: tests check signatures, amount/order/currency mismatches, disabled payments, duplicate notifications and retryable unresolved payments. No actual payment is made.

From ml-service/:

```powershell
python -m pip install --upgrade pip==26.2
python -m pip install -r requirements.txt pytest==9.1.1 httpx==0.28.1
python -m pytest tests -q
python -m pip check
```

The model suite loads the saved model, checks readiness/authentication and predictions, and covers preprocessing, split/resampling boundaries, threshold selection, explanations and replay generation. It does not retrain the full dataset on every run.

## Browser checks with real services

Use VITE_USE_MOCK=false and the actual local API origin. Start PostgreSQL, the API and model service. Keep PAYMENTS_ENABLED=false for this checklist unless specifically testing Razorpay test credentials.

1. Confirm both /health endpoints succeed. Register a fresh user, save the recovery codes privately, and confirm the dashboard starts empty.
2. Simulate ten rows and a fraud burst. Check real model scores, chart totals and saved rows after reload.
3. Filter flagged rows, page through results, view explanations, and mark rows legitimate/fraud. The alert count and flagged results must reflect decisions.
4. Change the profile name; changing email must also require the current password. Refresh, log out, and sign in with the new email.
5. Check a second user's account cannot see or change the first user's private records.
6. Upload a compatible CSV and an invalid CSV. Confirm meaningful results and validation errors.
7. Change English/Hindi, brightness, theme, font size and font family. Refresh to check persistence.
8. Check 1440/390/320-pixel widths and direct refreshes of /flagged, /profile and /settings.
9. Verify disabled checkout is clearly explained. Do not report a fake payment success.
10. Stop/restart the API and confirm PostgreSQL records remain. An unavailable model should result in manual review rather than fabricated scores.

Use a dedicated test account for the security checks below. Do not print its password, tokens or recovery codes:

- Change the password; the old password and old sessions must stop working.
- Generate replacement recovery codes; every code from the previous set must fail.
- Recover with one code and set a new password. Reusing that code must fail, including when requests arrive concurrently.
- Sign out, then verify the old token is rejected by the API. Sign out all sessions and verify a second login session is also rejected.
- Invalid account/code combinations must not identify which value was wrong. Check that repeated attempts are limited.
- Confirm no password, session token or recovery code appears in server logs or permanent browser storage beyond the intended login token.

Razorpay test checkout still needs provider credentials and a reachable configured webhook to verify the complete provider round trip. Unit tests, a disabled button, and mock checkout do not prove that external connection. Captured payments have no dataset-compatible features and must remain unscored for manual review.

## Optional mock regression

VITE_USE_MOCK=true provides the separate frontend demonstration. Verify its banner and no-payment notice. Mock transactions reset on reload, while demo profile/preferences stay in browser storage. Switching back to real mode requires a fresh real sign-in.

## Published-service checks

The frontend, PostgreSQL API and model service were deployed on 25 November 2026 with mock mode disabled. The hosted verification included real account registration/login, five XGBoost-scored historical transactions, explanations, review persistence, per-account isolation and disabled checkout. This is a record of that release, not an assertion that every later commit has been tested.

Run the current public check after a deployment:

```powershell
python scripts/verify_deployment.py --max-wait 120
```

It checks frontend routes and the main JavaScript asset, API/database health, allowed and rejected browser origins, anonymous account access, model readiness and the model's authentication boundary. Requests are read-only and retries are limited. It does not create users, move money, verify email delivery, test backups, or replace authenticated workflow testing. A nonzero exit status means at least one check failed. The GitHub **Check published website** workflow runs this same command only when manually requested.

## Historical local verification record — 25 November 2026

The deployment preparation was checked with PostgreSQL 17.12, Python 3.12 and the committed XGBoost artifact. The API/repository suite passed 43 tests against real PostgreSQL and SQLite, with no PostgreSQL skips. The ML suite passed 34 tests. The frontend suite passed 32 tests and 16 real-service browser scenarios passed 54 assertions, including phone layouts. The local database backup/restore and forward-migration restart checks preserved the test records. GitHub CI passed for commit `8bcaa66057a363f9a09f14803770f47674aaff14`; the frontend, API and ML services were then deployed successfully. These historical counts predate the recovery-code and session-security update.

A dependency advisory review on 25 November 2026 identified and patched follow-redirects 1.16.1 to 1.16.2 in the npm lockfile. Python runtime/model packages had no advisories in the queried PyPI records; build bootstrap pins pip 26.2 to avoid advisories in the old installer. This is a package advisory check, not a guarantee against unknown vulnerabilities or an operating-system audit.

A fresh installation from the patched npm lockfile also passed all 32 client tests, lint with zero warnings, and the production build. The production bundle passed three additional browser scenarios with 11 assertions, including API registration, live polling, profile persistence and disabled checkout. No payment-provider request occurred.
