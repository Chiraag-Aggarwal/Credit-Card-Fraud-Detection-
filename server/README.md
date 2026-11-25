# Fraud Dashboard API (Python)

This is the active FastAPI backend, using PostgreSQL through SQLAlchemy. The old Express/MongoDB app in legacy-express/ is reference only.

## Local setup

Use Python 3.12 and PostgreSQL. Copy .env.example to .env and fill DATABASE_URL, a random JWT_SECRET of at least 32 characters, CLIENT_URL, ML_SERVICE_URL and the shared ML_API_KEY.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip==26.2
python -m pip install -r requirements.txt
python scripts/migrate_database.py
uvicorn app.main:app --host 127.0.0.1 --port 5000
```

/health checks the database and returns 503 when unavailable. Startup requires the current Alembic revision. [Database setup/import/backup](../docs/POSTGRESQL.md).

## Deployment

Set APP_ENV=production, an exact HTTPS CLIENT_URL, public HTTPS ML_SERVICE_URL and the same strong ML_API_KEY on both services. Neon connections need SSL. Run migrations before `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; the Blueprint does this automatically. [Full deployment guide](../docs/DEPLOYMENT.md).

The in-process rate limiter is for a single instance. Multiple workers need a shared limiter. Limits per client address per 15 minutes: 1,200 general requests, ten authentication/simulation calls, twenty batch/checkout calls. Signed webhooks bypass browser limits. JSON bodies are limited to 512 KB.

Access/checkout tokens have separate audiences and purposes. Old sessions require sign-in again. Passwords retain whitespace, with at least eight characters and at most 72 UTF-8 bytes. Data is scoped to its owner; transaction responses exclude model features and password hashes.

## Payments

Leave PAYMENTS_ENABLED=false without credentials. GET /api/payments/status reports availability without secrets. Test checkout requires Razorpay test key ID/secret, webhook secret, PAYMENTS_ENABLED=true and ALLOW_LIVE_PAYMENTS=false.

The API verifies signatures, order ownership, captured status, amount and currency. Payment IDs are unique. Webhook receipts are durable; unmatched events return a retryable error. Monitor pending receipts and reconcile with Razorpay if retries expire.

Payments lack the historical model's anonymous input features and are saved UNSCORED for manual review. No unrelated sample score is attached. Historical simulation and batch analysis still use the trained model. Automatic refunds/disputes and live fraud prevention are outside this release.

## Tests

```powershell
python -m unittest discover -s tests -v
```

Set TEST_DATABASE_URL to a disposable PostgreSQL database for real database tests. Each suite uses its own random schema. Without it, API tests explicitly use temporary SQLite; deployed startup refuses SQLite. External model/payment calls are mocked. [API contract](../docs/API_CONTRACT.md).
