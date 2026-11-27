# Deploy the dashboard with PostgreSQL

The published installation uses Neon PostgreSQL, the Python API, the committed ML model, and a React frontend with mock mode disabled. Razorpay is deliberately disabled and assigned to the payment integration owner. This guide also explains how to create a separate installation; copying these files alone does not provision services or activate payments.

Current addresses are listed in the [README](../README.md). For an existing installation, update its connected services instead of creating duplicates. Deploy the API migration and wait for healthy startup before publishing a frontend that depends on new endpoints. Security updates that introduce revocable sessions require users to sign in again.

## 1. Prepare the repository and database

1. Put the current repository on your GitHub account and confirm its **CI** workflow passes. It tests the frontend, the API against PostgreSQL, and the ML service. Keep `.env` files and credentials out of Git.
2. Create a PostgreSQL project/database in Neon. In its **Connect** dialog, copy the real connection string, including `sslmode=require` and any other supplied TLS options. A direct connection is simplest for this single-instance setup because the same URL runs migrations and serves requests. Store it privately as `DATABASE_URL`; the app accepts `postgresql://` and `postgresql+psycopg://` URLs. See [Neon connection instructions](https://neon.com/docs/connect/connect-from-any-app).
3. Use an empty database for a new installation. If you have existing records, follow [PostgreSQL imports, backups and restore checks](POSTGRESQL.md) before switching traffic.

## 2. Deploy using the Render Blueprint

In Render, choose **New → Blueprint**, connect your repository, and select its root [render.yaml](../render.yaml). Review the three services and choose the intended branch. The Blueprint provisions no database; it uses your external Neon database.

Enter these values when Render prompts you:

| Service | Setting | Value to enter |
| --- | --- | --- |
| `fraud-api` | `DATABASE_URL` | Your private Neon connection string with TLS enabled. |
| `fraud-api` | `CLIENT_URL` | The frontend's exact public HTTPS origin, without a path, query, or fragment. |
| `fraud-api` | `ML_SERVICE_URL` | The ML service's public HTTPS URL, without an endpoint suffix. |
| `fraud-dashboard` | `VITE_API_URL` | The API's public HTTPS origin, without `/api` or another path. |

Copy the actual URLs from Render; service names alone do not guarantee a particular public URL. If these URLs have not been assigned yet, use the manual sequence below to create the services and connect them. Do not substitute invented URLs or credentials.

The Blueprint sets `APP_ENV=production` on both Python services, generates `JWT_SECRET`, and generates one `ML_API_KEY` in the `fraud-service-auth` environment group shared by both services. It also sets `VITE_USE_MOCK=false`, `PAYMENTS_ENABLED=false`, and `ALLOW_LIVE_PAYMENTS=false`. Keep these defaults for the first deployment.

Render prompts for `sync: false` values during initial Blueprint creation. Later changes to those values must be made in each service's Environment settings. Changing `VITE_API_URL` requires rebuilding the frontend because Vite embeds it at build time. See the [Blueprint environment-variable reference](https://render.com/docs/blueprint-spec#prompting-for-secret-values).

## Manual setup if you need to obtain the URLs first

Create each service from the same repository and branch, in this order. Use Python 3.12 for both web services and Node 22 for the static site's build. Select the Free instance explicitly for web services if that is your intended plan.

1. **Create the ML Web Service.** Set root directory to `ml-service`, build command to `python -m pip install --upgrade pip==26.2 && python -m pip install -r requirements.txt`, start command to `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, and health-check path to `/health`. Set `APP_ENV=production`, `OMP_NUM_THREADS=1`, and `OPENBLAS_NUM_THREADS=1`. Generate a random `ML_API_KEY` of at least 32 characters in your password manager, save it privately, and set it on this service. Copy the service's public HTTPS URL after creation.
2. **Create the API Web Service.** Set root directory to `server`, build command to `python -m pip install --upgrade pip==26.2 && python -m pip install -r requirements.txt`, start command to `python scripts/migrate_database.py && uvicorn app.main:app --host 0.0.0.0 --port $PORT`, and health-check path to `/health`. Set `APP_ENV=production`, your `DATABASE_URL`, a separately generated random `JWT_SECRET` of at least 32 characters, the actual ML URL as `ML_SERVICE_URL`, and the exact same `ML_API_KEY`. Set both payment flags to `false`. Copy the API's public HTTPS URL. Its first startup will remain unsuccessful until you set the frontend origin in step 4; do not bypass production validation.
3. **Create the frontend Static Site.** Set root directory to `client`, build command to `npm ci && npm run build`, and publish directory to `dist`. Set `NODE_VERSION=22`, `VITE_USE_MOCK=false`, and `VITE_API_URL` to the API origin from step 2. Add a **Rewrite** from `/*` to `/index.html` so browser refreshes on dashboard routes work. Copy the static site's public HTTPS origin.
4. **Finish the API connection.** Set its `CLIENT_URL` to the exact frontend origin from step 3, then redeploy the API. Confirm migrations complete and both Python `/health` endpoints return HTTP 200. Keep the API and ML keys identical; none of the database, JWT, ML, or Razorpay secrets belongs in frontend `VITE_*` variables.

For manual services, configure automatic deployments to wait for CI checks. The Blueprint already selects this behavior. The migration helper runs before the API accepts requests and can be rerun safely. Free services do not support a separate pre-deploy command; for a paid/scaled deployment, move migrations to `preDeployCommand` and plan schema-compatible releases. See [Render deployment commands](https://render.com/docs/blueprint-spec#service-fields).

On a manually configured frontend, add these response headers for path `/*` under **Headers**. The Blueprint includes them in `render.yaml`:

| Header | Value |
| --- | --- |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |

These prevent content-type guessing and framing, limit referrer details, and disable device permissions the dashboard does not use. They do not replace application authentication or a deployment check.

## 3. Check the deployed application

Complete these checks against the deployed URLs before sharing the site:

- Open ML `/health`: expect `model_loaded: true` and a model version. ML `/model-info` without the shared key should return HTTP 401.
- Open API `/health`: expect `database: true`. A healthy database alone does not prove that scoring is connected.
- Register a new account, log out, and log in again. A second account must not see the first account's transactions.
- Run a small transaction simulation. Check that real scores appear, the model information loads, and a scored transaction has an explanation. Simulation uses historical dataset samples and is clearly separate from payments.
- Refresh a nested frontend route directly. Review a flagged transaction, refresh, and confirm the decision persists. After a normal API redeploy, confirm the account and transaction still exist.
- Confirm checkout shows payments unavailable while disabled. The authenticated `/api/payments/status` response should contain `enabled: false` and `mode: "disabled"`.
- Verify recovery-code generation, one-time use and session revocation with a dedicated test account, following [the security checks](TESTING.md#browser-checks-with-real-services).

From the repository root, `python scripts/verify_deployment.py` runs the public read-only checks. Use `--frontend`, `--api`, and `--ml` to supply different HTTPS origins for another installation. The script accepts no credentials and prints no response bodies. It allows a bounded warm-up period for free services; readiness does not imply continuous availability.

If login fails, check `VITE_API_URL`, `CLIENT_URL`, and the API logs. If scores are unavailable, check ML readiness, the public HTTPS ML URL, and matching keys. An unavailable model leaves transactions unscored and awaiting review; it must not produce a fabricated probability.

## 4. Optional Razorpay test activation

The application owner has deferred this part to their partner. Keep both payment flags false until that owner completes the [payment handoff](PAYMENT_HANDOFF.md). No replacement payment provider is needed to publish and use the account, analysis and review features.

An approved live account is not assumed. You can deploy and use the dashboard while Razorpay remains disabled.

1. When your Razorpay account offers test keys, select **Test Mode** in its dashboard and generate the test key pair. Store the real values on the **API service only** as `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. The test key ID starts with `rzp_test_`; do not use example values. Test mode simulates payments and does not collect real money. See [Razorpay API keys and modes](https://razorpay.com/docs/payments/dashboard/account-settings/api-keys).
2. Generate a separate webhook secret. Set it as API `RAZORPAY_WEBHOOK_SECRET` and enter the identical value in the Razorpay webhook configuration. In **Test Mode**, add a public HTTPS webhook URL consisting of your API origin followed by **`/api/webhooks/razorpay`**, and select **`payment.captured`**. The backend verifies signatures; the webhook secret is separate from the API key secret. See [Razorpay webhook setup](https://razorpay.com/docs/webhooks/setup-edit-payments).
3. Set API `PAYMENTS_ENABLED=true`, leave `ALLOW_LIVE_PAYMENTS=false`, and redeploy. Confirm the payment status reports `mode: "test"`. Use Razorpay's documented test payment methods, verify successful capture, and confirm a repeated webhook does not create a duplicate transaction.

Captured Razorpay payments do not supply this model's anonymized `V1`–`V28` features. They are stored as **UNSCORED / pending review**, with no invented fraud score. Historical sample scoring and payment capture are different capabilities.

Live processing is a separate step after Razorpay account approval, website verification, successful test reconciliation, and an explicit decision to accept real payments. It requires actual live keys, the live-mode webhook configuration, `PAYMENTS_ENABLED=true`, and `ALLOW_LIVE_PAYMENTS=true`. Leave live payments disabled until those steps are complete; a deployed page or passing tests do not establish live-payment readiness.

## Hosting limits and ongoing operations

Render's free web services sleep after inactivity, have resource limits, and cannot receive private-network requests. Use the ML service's **public HTTPS** URL, and expect cold starts to delay initial requests or temporarily leave a simulation unscored. Free hosting is suitable for a demonstration; reliable customer payments need measured availability and a hosting plan that meets it. Razorpay webhook delivery deadlines make sleeping services especially unsuitable for claiming reliable live processing. See [Render free-service limits](https://render.com/docs/free) and [Razorpay delivery/retry behavior](https://razorpay.com/docs/webhooks/setup-edit-payments#deactivation).

Keep database backups and rehearse restores using [POSTGRESQL.md](POSTGRESQL.md#backups-and-restore-drills). Review service errors and payment reconciliation after deployments. Rotate shared ML keys on both services together, and expect changing `JWT_SECRET` to sign users out. Keep test and live payment credentials and data distinct.

The manual **Check published website** GitHub workflow is a troubleshooting tool, not continuous monitoring. It is not scheduled and does not create an availability guarantee. Configure any future uptime alerts deliberately, and record the responsible owner and notification destination.
