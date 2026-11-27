# Security and account access

Use the current published release and keep credentials out of Git, screenshots and support messages. The deployment uses HTTPS, signed login tokens, password hashes, per-user data access and a separate key for the model service. These measures do not replace careful hosting configuration, dependency updates or testing.

## Recovering your account

Save the recovery codes shown at registration somewhere private. The server stores only their hashes. Each code can reset the password once when paired with the account's sign-in email. Regenerating codes replaces the previous set. Password recovery invalidates old login sessions.

The profile page lets you change your password, create replacement codes and sign out all sessions. Changing the sign-in email requires the current password. There is no email-verification or email-reset service. If you lose both the password and every code, automatic recovery is unavailable; the application does not bypass this with security questions or a public reset link.

Never give another person a recovery code to help them investigate an error. Treat a downloaded or copied code list as a password. Do not include it in backups that other people can read.

## Reporting a vulnerability

Contact the project maintainer privately through the contact details they provide. Public repository issues are suitable for non-sensitive bugs, but must not contain passwords, recovery codes, login tokens, private transaction records or hosting credentials. No response-time commitment or bug bounty is offered by this repository.

## Deployment responsibilities

- Keep `DATABASE_URL`, `JWT_SECRET`, `ML_API_KEY` and payment secrets only in the relevant backend secret stores. `VITE_*` values are public.
- Keep the API's allowed browser origin limited to the actual frontend. Do not disable TLS verification or publish the model key in the browser.
- Back up PostgreSQL and verify restoration to a separate database before relying on a backup. Protect backups as carefully as the live database.
- Use a dedicated test account when checking password recovery, session revocation or payment behaviour.
- Leave payments disabled until the [payment owner completes testing](docs/PAYMENT_HANDOFF.md).

For the current auth endpoints and error shapes, use [the API contract](docs/API_CONTRACT.md). For what the application stores, see [data handling](PRIVACY.md).
