# API Contract

This document defines the request and response shapes used by the Fraud Detection Payment Dashboard. JSON values shown below are illustrative; field names and types define the contract.

## Base URL and conventions

- Configure the API base URL with `VITE_API_URL`.
- Local base URL: `http://localhost:5000`.
- Every endpoint path below starts with `/api`.
- Requests and responses use JSON.
- Protected endpoints require `Authorization: Bearer <token>`. The token is returned by registration or login.
- Errors use this shape: `{ "error": { "message": "...", "code": "..." } }`.
- `401` means unauthenticated, `422` means invalid input, and `429` means rate limited.
- The Python API rate-limits general API traffic to 1,200 requests per 15 minutes per client address; login/registration and simulation each allow 10 requests per 15 minutes.
- Responses use `id`, not `_id`, and never include the 30 model input features.

## Transaction

| Field | Type / values |
| --- | --- |
| `id` | string |
| `createdAt` | ISO date-time string |
| `displayAmount` | number in major currency units, such as `49.99` |
| `currency` | lowercase currency code, such as `inr` or `usd` |
| `source` | `razorpay`, `simulated`, or `stripe` for historical records |
| `fraudProbability` | number from `0` to `1`, or `null` when unscored |
| `riskLabel` | `LOW`, `MEDIUM`, `HIGH`, or `UNSCORED` |
| `isFlagged` | boolean |
| `scoringStatus` | `scored` or `pending_review` |
| `scoringReason` | `null`, `model_unavailable`, or `unsupported_payment_features` |
| `paymentMode` | `null`, `test`, or `live`; provider test payments are explicitly labelled |
| `modelVersion` | string, such as `xgb-v1` |
| `reviewDecision` | `null`, `confirmed_fraud`, or `legit` |
| `stripePaymentIntentId` | string or `null` |
| `razorpayPaymentId` | string or `null` |

## Endpoints

### Deployment health

`GET /health` is public. It returns `200 {"status":"ok","database":true}` after a successful PostgreSQL check, or `503 {"status":"unavailable","database":false}`. ML readiness is checked separately on the ML service.

### Authentication

#### `POST /api/auth/register` - public

Request:

```json
{
  "name": "Avery Merchant",
  "email": "avery@example.com",
  "password": "at-least-8-characters"
}
```

`password` must have at least 8 characters and at most 72 UTF-8 bytes. Whitespace is preserved; oversized passwords are rejected rather than truncated. Response status is `201`.

```json
{
  "token": "<jwt>",
  "user": {
    "id": "user-id",
    "name": "Avery Merchant",
    "email": "avery@example.com",
    "role": "<role>"
  }
}
```

#### `POST /api/auth/login` - public

Request:

```json
{
  "email": "avery@example.com",
  "password": "password"
}
```

Response:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "user-id",
    "name": "Avery Merchant",
    "email": "avery@example.com",
    "role": "<role>"
  }
}
```

#### `GET /api/auth/me` - token required

Response:

```json
{
  "user": {
    "id": "user-id",
    "name": "Avery Merchant",
    "email": "avery@example.com",
    "role": "<role>"
  }
}
```

#### `PATCH /api/auth/me` - token required

Updates only the signed-in user's name and email. Both fields are required; names are trimmed and must be 1–120 characters. Email addresses must be valid, at most 254 characters, and are stored in lowercase. Unknown fields (including `id`, `role`, and `password`) are rejected with `422`.

Request:

```json
{
  "name": "Avery Merchant",
  "email": "avery.new@example.com"
}
```

Response status is `200`, with the same `{ "user": { "id", "name", "email", "role" } }` shape as `GET /api/auth/me`. The user ID and role do not change. The existing JWT remains valid because its subject is the user ID; subsequent login uses the new email and the existing password.

An email already owned by another account returns `409` with `{ "error": { "message": "An account with this email already exists.", "code": "EMAIL_EXISTS" } }`. Missing or invalid authentication returns `401`. Updates are scoped to the authenticated user and never accept a target user ID from the request.

In mock mode, demo profiles (never passwords) are saved in browser local storage, separately from real accounts. Stable mock user IDs keep profile edits available across refreshes. Restricted browser storage falls back to the current in-memory session. Mock registration/login remains a demonstration and accepts a password with 8 or more characters.

### Transactions

#### `POST /api/predictions/batch` - token required

Scores 1–100 transactions without saving them. Each item must contain exactly `Time`, `V1` through `V28`, and `Amount`, matching the ML model input; all values must be finite and `Amount` must be non-negative. The optional dataset label `Class` must not be sent.

Request:

```json
{
  "transactions": [
    { "Time": 0, "V1": 0, "V2": 0, "V3": 0, "V4": 0, "V5": 0, "V6": 0, "V7": 0, "V8": 0, "V9": 0, "V10": 0, "V11": 0, "V12": 0, "V13": 0, "V14": 0, "V15": 0, "V16": 0, "V17": 0, "V18": 0, "V19": 0, "V20": 0, "V21": 0, "V22": 0, "V23": 0, "V24": 0, "V25": 0, "V26": 0, "V27": 0, "V28": 0, "Amount": 49.99 }
  ]
}
```

Response:

```json
{
  "count": 1,
  "items": [
    {
      "index": 0,
      "fraudProbability": 0.12,
      "riskLabel": "HIGH",
      "isFlagged": true,
      "threshold": 0.0795,
      "modelVersion": "xgboost-v1"
    }
  ]
}
```

`index` is zero-based in the submitted list. The result contains no input features, and predictions are not persisted.

#### `GET /api/transactions` - token required

Query parameters:

- `page` (default `1`)
- `limit` (default `20`)
- `riskLabel`
- `flagged` (`true` to show flagged transactions)
- `from` and `to` (ISO dates)

Results are newest first.

```json
{
  "items": [
    {
      "id": "transaction-id",
      "createdAt": "2026-10-25T12:30:00.000Z",
      "displayAmount": 49.99,
      "currency": "usd",
      "source": "razorpay",
      "fraudProbability": 0.12,
      "riskLabel": "LOW",
      "isFlagged": false,
      "scoringStatus": "scored",
      "modelVersion": "xgb-v1",
      "reviewDecision": null,
      "stripePaymentIntentId": null,
      "razorpayPaymentId": "pay_example"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

#### `GET /api/transactions/stats` - token required

```json
{
  "total": 100,
  "flagged": 8,
  "fraudRate": 0.08,
  "avgProbability": 0.12,
  "byRisk": {
    "LOW": 80,
    "MEDIUM": 12,
    "HIGH": 8,
    "UNSCORED": 0
  },
  "series24h": [
    { "t": "2026-10-25T12:00:00.000Z", "total": 4, "flagged": 1 }
  ],
  "series30d": [
    { "t": "2026-10-25T00:00:00.000Z", "total": 12, "flagged": 2 }
  ]
}
```

`fraudRate` and `avgProbability` are numbers from `0` to `1`. Despite its legacy name, `fraudRate` is the flagged share, not confirmed fraud incidence. Unscored rows are excluded from the average and histogram. `series24h` is hourly and `series30d` is daily; `t` is an ISO date-time string.

#### `GET /api/transactions/score-histogram` - token required

Returns 10 score bins spanning `0.0` to `1.0`.

```json
{
  "bins": [
    { "from": 0.0, "to": 0.1, "count": 12 }
  ]
}
```

#### `POST /api/transactions/simulate` - token required

Request `count` is from `1` to `50`; `mode` is `random` or `fraud`.

```json
{
  "count": 1,
  "mode": "random"
}
```

Response:

```json
{
  "created": 1,
  "items": [
    {
      "id": "transaction-id",
      "createdAt": "2026-10-25T12:30:00.000Z",
      "displayAmount": 49.99,
      "currency": "usd",
      "source": "simulated",
      "fraudProbability": 0.12,
      "riskLabel": "LOW",
      "isFlagged": false,
      "scoringStatus": "scored",
      "modelVersion": "xgb-v1",
      "reviewDecision": null,
      "stripePaymentIntentId": null,
      "razorpayPaymentId": null
    }
  ]
}
```

#### `PATCH /api/transactions/:id/review` - token required

Request `decision` is `confirmed_fraud` or `legit`.

```json
{
  "decision": "confirmed_fraud"
}
```

Response is the updated `Transaction` object. `legit` sets `isFlagged=false`; `confirmed_fraud` sets it to true. Model probability/risk are preserved. The database stores the reviewer and review time; review decisions do not refund or block payments.

#### `GET /api/transactions/:id/explanation` - token required

Returns the top five feature impacts for a scored transaction owned by the authenticated merchant. The response does not expose the transaction's full model input. XGBoost uses TreeSHAP; logistic regression uses exact coefficient contributions. `impact` is in log-odds: positive increases the model's fraud score and negative lowers it. A transaction without a completed model score returns `409`.

```json
{
  "transactionId": "transaction-id",
  "fraudProbability": 0.91,
  "threshold": 0.0795,
  "modelVersion": "xgboost-v1",
  "method": "tree_shap",
  "baselineLogOdds": -4.2,
  "topFactors": [
    {
      "feature": "V14",
      "value": -2.5,
      "impact": 3.1,
      "direction": "increases_risk"
    }
  ]
}
```

Each `topFactors` item has `feature` (string), `value` (number), `impact` (number), and `direction` (`increases_risk` or `decreases_risk`). These are model explanations, not proof that a transaction is fraudulent.

### Payments

#### `GET /api/payments/status` - token required

```json
{"provider":"razorpay","mode":"disabled","enabled":false,"reason":"Payments are not enabled. Account activation and payment keys are required."}
```

`mode` is `disabled`, `test`, or `live`; `enabled` is boolean; `reason` is a user-readable string when disabled, otherwise null. No secrets are returned. Defaults are `PAYMENTS_ENABLED=false` and `ALLOW_LIVE_PAYMENTS=false`. Test mode needs configured Razorpay test credentials plus payments enabled. Live mode additionally needs live credentials and `ALLOW_LIVE_PAYMENTS=true`; account approval remains external. Mock mode reports an explicitly simulated test checkout and makes no provider call.

#### `POST /api/payments/checkout-session` - token required

Request `amount` is from `1` to `999999.99`, with at most two decimal places; `currency` is `inr`, and `mode` must be `normal`. `fraud-demo` is rejected: use the simulation endpoint for historical fraud examples. The integration uses Razorpay. Checkout returns `503 PAYMENTS_UNAVAILABLE` when disabled or unconfigured. Test credentials are supported; live credentials additionally require deliberate activation.

```json
{
  "amount": 1,
  "currency": "inr",
  "mode": "normal"
}
```

Response (the browser navigates to `url`):

```json
{
  "url": "https://dashboard.example.com/checkout?order_id=...&key_id=...&amount=100&currency=INR&session_token=...&mode=test"
}
```

The API creates a Razorpay Order server-side and stores its merchant, amount, currency, and payment mode. `key_id` is the public Razorpay key ID; `session_token` is a short-lived signed checkout token. The client moves the checkout token into tab session storage and removes it from the URL before rendering. Access JWTs and checkout JWTs have separate audiences/purposes; a checkout token cannot sign into the API. Keep the Razorpay secret only on the API server. The API accepts only captured payments after verifying both the Razorpay checkout signature and payment status.

Provider payments do not supply the anonymized PCA model inputs. They are recorded with the real provider amount and IDs, `fraudProbability=null`, `riskLabel="UNSCORED"`, `scoringStatus="pending_review"`, and `scoringReason="unsupported_payment_features"`. No replay row, ground-truth label, or model score is invented for a payment. `paymentMode` is taken from the stored order, not user input. Simulation remains a separate, labelled feature.

#### `POST /api/payments/verify` - signed checkout session

Razorpay Checkout sends the following fields to the client handler. The backend verifies the signed session, payment signature, order ownership, amount, currency, and captured status before recording an unscored transaction for manual review.

Request:

```json
{
  "sessionToken": "<short-lived-checkout-token>",
  "razorpay_payment_id": "pay_example",
  "razorpay_order_id": "order_example",
  "razorpay_signature": "<razorpay-signature>"
}
```

Response:

```json
{
  "transaction": {
    "id": "transaction-id",
    "createdAt": "2026-10-25T12:30:00.000Z",
    "displayAmount": 1,
    "currency": "inr",
    "source": "razorpay",
    "fraudProbability": null,
    "riskLabel": "UNSCORED",
    "isFlagged": true,
    "scoringStatus": "pending_review",
    "scoringReason": "unsupported_payment_features",
    "paymentMode": "test",
    "modelVersion": "",
    "reviewDecision": null,
    "stripePaymentIntentId": null,
    "razorpayPaymentId": "pay_example"
  }
}
```

#### `POST /api/webhooks/razorpay` - Razorpay webhook

Configure the Razorpay webhook to send `payment.captured` events to this path. The API validates `X-Razorpay-Signature` against the exact body. PostgreSQL stores event ID/digest, payment ID and completion status; payment IDs are unique. Duplicate events return success after durable completion. An event whose order is missing or mismatched returns a retryable `503`, never a false acknowledgement. Monitor pending receipts and reconcile against the provider if retries expire. Other event types are acknowledged but refunds/disputes are not automatically processed. Webhooks do not wait for an ML call.

### Model information and alerts

#### `GET /api/model-info` - token required

```json
{
  "model_version": "xgb-v1",
  "threshold": 0.5,
  "min_precision": 0.9,
  "trained_at": "2026-10-25T12:30:00.000Z",
  "metrics": {
    "precision": 0.91,
    "recall": 0.84,
    "f1": 0.87,
    "roc_auc": 0.96,
    "pr_auc": 0.73,
    "confusion_matrix": [[980, 20], [8, 42]]
  }
}
```

#### `GET /api/alerts/unread-count` - token required

Returns the number of flagged transactions that have not been reviewed.

```json
{
  "count": 3
}
```

## Request limits and authentication

JSON bodies are limited to 512 KB; oversized requests return `413 PAYLOAD_TOO_LARGE`. Authentication and simulation allow ten requests per 15 minutes per address; batch prediction and checkout allow twenty. General traffic allows 1,200. Signed webhooks bypass the browser limiter. `429` includes `Retry-After`. The current limiter is per process; use shared limits before adding API workers.

Access tokens require audience `fraud-dashboard`, issuer `fraud-api`, type `access`, and expiration. Checkout tokens use audience `fraud-checkout` and type `checkout`. Older sessions require signing in again. The real and mock browser sessions use separate keys.
