# How the application handles data

This document describes the current academic application's behaviour. It does not promise a commercial service level or represent provider policies.

## Data used by the application

| Data | Use and storage |
| --- | --- |
| Name and sign-in email | Stored in PostgreSQL to identify and manage an account. Email ownership is not verified by this deployment. |
| Password | Stored as a password hash, never as the original password. |
| Recovery codes | Their hashes are stored for one-time account recovery; original codes are shown when generated. |
| Login sessions | Session records support expiration and revocation. The browser holds the login token needed for authenticated requests. |
| Historical simulation records | Stored in PostgreSQL with scores, model version and the owning account. These are dataset samples, not actual card charges. |
| Review decisions | Stored with the related transaction and review audit information. |
| Batch CSV inputs | Sent to the API and model service for the requested analysis. The batch endpoint does not save these rows as transactions. |
| Language and appearance preferences | Saved locally in that browser. |

Do not upload card numbers, CVVs, bank credentials or personal customer records. The model expects the documented numerical dataset features. It does not need a customer's identity or card details.

## Hosting and payments

The frontend, API and model service run on Render; the PostgreSQL database is hosted by Neon. Those providers may keep their own infrastructure and access logs under their policies. The application does not intentionally log submitted passwords or recovery codes.

Payments are disabled. If the payment integration owner enables a provider later, checkout details are entered in that provider's flow. The application stores provider identifiers, amounts and payment state; it must not collect raw card credentials. That integration requires its own review before real-money use.

## Access and retention

Authenticated users can access their own transactions and profile. The project maintainers and authorised hosting administrators can administer the underlying database and services. Account and transaction records remain until the maintainers deliberately remove them; there is currently no automatic account-deletion or fixed retention period. Backups can retain earlier records according to the hosting configuration.

For an account-data request, contact the project maintainer directly using the contact details they provide. Do not include credentials or private transaction details in a public GitHub issue. Signing out ends the application's login session; it does not delete saved records. See [security guidance](SECURITY.md) for account recovery and revocation.
