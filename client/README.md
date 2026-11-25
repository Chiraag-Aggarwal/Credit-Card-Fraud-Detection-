# Fraud detection dashboard

React and Vite frontend for the fraud review API. The same interface supports a real backend and an explicitly enabled browser demo.

## Local development

Use Node.js 22 and run these commands from `client/`:

```sh
npm ci
```

Copy `.env.example` to `.env`, set `VITE_API_URL` to the running backend origin, then run `npm run dev`. The example uses `http://localhost:5000` and `VITE_USE_MOCK=false`. Restart Vite after changing environment variables. The development server has no built-in API proxy, so configure the API URL for a normal local setup.

For an independent demo, explicitly set `VITE_USE_MOCK=true`. Demo checkout processes no payment; model outputs and transactions are sample data. Demo transaction changes reset on reload, while demo profile details are stored in the browser. Switch back to `false` to use the real API.

## Production deployment

Set these build-time environment variables on the static-site host:

```dotenv
VITE_USE_MOCK=false
VITE_API_URL=https://your-api.onrender.com
```

Replace the example API address with the deployed backend's actual HTTPS origin. Use only the origin, with no `/api` suffix, credentials, query string, or fragment. An optional trailing slash is accepted. Public HTTP addresses are rejected; HTTP loopback addresses (`localhost`, `127.0.0.1`, and `[::1]`) are allowed for local builds and tests. A real build without `VITE_API_URL` fails with setup instructions instead of silently sending API requests to the static site.

The frontend and API can use different origins. Set the backend's `CLIENT_URL` to the frontend's exact public origin so its CORS responses and checkout links target this site. All `VITE_` values are public in the browser bundle: never place database credentials, JWT secrets, or Razorpay secrets in them. The build requires only the public API address; PostgreSQL and provider credentials belong to the backend.

On Render, use root directory `client`, build command `npm ci && npm run build`, and publish directory `dist`. Configure a rewrite from `/*` to `/index.html` so sign-in, review, settings, and checkout routes also work when opened directly. The repository's Render Blueprint includes these settings. Rebuild the static site whenever a `VITE_` value changes; changing runtime settings alone does not update an existing bundle.

## Sessions and payments

Real and demo authentication use separate browser storage keys, `fraud-dashboard-token-real` and `fraud-dashboard-token-mock`. Switching modes requires signing in to that mode; old shared-key sessions are not migrated. If browser storage is blocked, signing in still works for the current page session. Account session expiry redirects to sign-in, while a rejected login or expired checkout token does not erase an unrelated account session.

The dashboard checks `/api/payments/status` independently from transaction data. Checkout remains disabled with an English/Hindi availability message until the backend enables and configures Razorpay. Backend payments are disabled by default. A payment-status error does not prevent transaction review, simulations, or other dashboard data from loading.

Enabled Razorpay checkout is labeled as test or live, and transaction sources display the recorded payment mode when available. Test mode moves no real money; live mode charges the selected payment method. Real provider payments remain unscored and require manual review because they lack the trained model's required features. A model-service outage has its own distinct review reason.

Checkout bearer tokens are stored in this tab's `sessionStorage`, keyed by order ID, and removed from the browser URL/history before the checkout interface loads. Refresh can restore an unfinished checkout in the same tab when session storage is available. URLs must target this site's `/checkout` route. After a confirmed payment, the stored checkout token is removed.

## Checks

```sh
npm test
npm run lint
npm run build
```

Configure `VITE_API_URL` before building a real version, or explicitly select demo mode. Tests cover payment readiness, checkout refresh and URL validation, authentication isolation and expiry, browser storage failures, password bounds, profile updates, preferences, and request lifecycle handling. Live payment processing still requires a configured provider account and separate integration verification.
