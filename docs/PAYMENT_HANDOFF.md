# Payment integration handoff

The published website already works with real accounts, PostgreSQL, model scoring, analysis and saved reviews. Payment activation is intentionally left to the payment integration owner. Keep the existing integration disabled until its provider round trip is tested. There is no need to replace Razorpay merely to publish the rest of the application.

## What is implemented

- The Python API creates orders and verifies checkout signatures.
- The API accepts signed `payment.captured` notifications and prevents duplicate payment records.
- The dashboard shows checkout as unavailable while payments are disabled.
- Captured provider payments are saved for manual review. They are not assigned an invented AI score.

## Start with test mode

Configure these values in **Render → credit-card-fraud-api → Environment**. Never add secrets to the frontend, screenshots, Git or documentation.

| API setting | Value |
| --- | --- |
| `RAZORPAY_KEY_ID` | The provider's actual test key ID, starting with `rzp_test_` |
| `RAZORPAY_KEY_SECRET` | The matching private API key secret |
| `RAZORPAY_WEBHOOK_SECRET` | A separately generated secret, identical in Render and the provider's webhook settings |
| `PAYMENTS_ENABLED` | `true` only when test settings are complete |
| `ALLOW_LIVE_PAYMENTS` | `false` throughout test-mode verification |

In the Razorpay **Test Mode** webhook settings, use:

```text
https://credit-card-fraud-api-lacc.onrender.com/api/webhooks/razorpay
```

Select the `payment.captured` event. The endpoint must be publicly reachable. For another installation, replace only the API origin with its actual public address.

After the API redeploys, the authenticated `GET /api/payments/status` response must report `enabled: true` and `mode: "test"`. The current request and response shapes are in [API_CONTRACT.md](API_CONTRACT.md). Follow the provider's [API-key instructions](https://razorpay.com/docs/payments/dashboard/account-settings/api-keys) and [webhook instructions](https://razorpay.com/docs/webhooks/setup-edit-payments).

## Acceptance checks

1. Complete a provider test checkout and confirm exactly one stored transaction with the correct amount, currency, provider payment ID and `paymentMode: "test"`.
2. Replay the signed notification and confirm no duplicate transaction appears.
3. Try a cancelled or failed checkout and confirm it does not show a successful captured payment.
4. Confirm the other user's account cannot access the order, payment or resulting transaction.
5. Confirm invalid signatures and mismatched amounts/orders are rejected.
6. Confirm captured payments show `UNSCORED`, a null probability and `scoringReason: "unsupported_payment_features"`. Manual review must save normally.

Existing automated tests use mocked provider responses. They cannot prove that real account keys, the provider dashboard and webhook delivery have been connected correctly.

## If real money is required later

Complete provider account and website verification, use the actual live key pair and live webhook settings, and review reconciliation, refunds, support and service availability. Only then intentionally enable `ALLOW_LIVE_PAYMENTS=true` together with `PAYMENTS_ENABLED=true`. Do not switch these flags for a classroom presentation.

Razorpay does not supply the historical dataset's anonymous V1–V28 features. Automatic fraud scoring for new provider payments requires a separately trained and validated model using fields available from those payments. A person's review decision does not block, refund or reverse a captured payment.

Free services can sleep. Provider notifications have delivery deadlines and retry limits, so reliable payment operation needs an appropriate hosting arrangement and observed end-to-end tests. Payment activation is the remaining integration owner's responsibility; it is not implied by a successful website deployment.
