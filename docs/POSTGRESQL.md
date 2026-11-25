# PostgreSQL operations

PostgreSQL is the API's system of record. Use `DATABASE_URL` for the API and
migration command. `postgresql://`, `postgres://`, and
`postgresql+psycopg://` URLs work; the application uses Psycopg 3. Keep credentials
in the hosting secret store or an untracked local environment file. SQLite is
available only to explicitly opted-in automated tests.

## Schema deployment

From `server/`, with dependencies installed and `DATABASE_URL` configured:

```text
python scripts/migrate_database.py
uvicorn app.main:app --host 0.0.0.0 --port 5000
```

The migration command upgrades to the committed Alembic revision. It uses a
PostgreSQL advisory lock to serialize concurrent deployment migration commands.
Rerunning it is safe. Startup checks connectivity and the expected migration
revision; it does not silently create or modify production tables.

The initial migration creates `users`, `transactions`, `payment_checkouts`, and
`webhook_events`. Merchant ownership uses foreign keys. Email, payment IDs, and
checkout order IDs are unique. Monetary display amounts use `NUMERIC(18,2)`;
checkout amounts use integer paise. Dates are UTC timestamps. Provider webhook
receipts store an event ID and SHA-256 digest, not raw payment payloads.

Create future revisions with Alembic, inspect the generated SQL and compatibility
with the current API, then test against a restored database before deployment.
Use a database role with schema change permissions for migrations. A separate
runtime role can be limited to connection/schema access and `SELECT`, `INSERT`,
and `UPDATE` on application tables, plus `SELECT` on `alembic_version`. The app
uses no sequences and does not delete customer records.

## Import an existing MongoDB database

This is an optional cutover tool. New installations do not need MongoDB or the
extra dependency. No live migration or account provisioning has been performed
by preparing these files.

1. Export an original MongoDB backup using the existing provider's supported
   backup tooling. Confirm that the backup can be restored. Keep this original
   snapshot under the same access controls as the database.
2. Install `server/requirements-migration.txt`. Configure the source
   `MONGODB_URI` and, if it is absent from the URI, `MONGODB_DATABASE`. Configure
   the destination `DATABASE_URL`. Never place either connection string in Git
   or a shell command argument.
3. Apply PostgreSQL schema migrations. Preview the import from `server/`:

   ```text
   python scripts/migrate_mongodb.py
   ```

4. Stop legacy writers and keep them stopped through cutover. Take the final
   source backup and run the preview again. Resolve reported conflicts or
   orphaned merchant references before importing.
5. Insert the source records:

   ```text
   python scripts/migrate_mongodb.py --apply
   ```

6. Rerun the command and verify matching records are skipped. Compare collection
   counts and representative users, transactions, checkout amounts, dates, and
   review decisions. Test a migrated login, merchant isolation, and dashboard
   data before routing traffic to the PostgreSQL API.

The importer reads the source; it never updates or deletes MongoDB records.
It preserves MongoDB IDs as strings, password hashes, monetary amounts,
timestamps, merchant relationships, provider IDs (including legacy Stripe event
IDs), and review decisions. Existing
destination records are never overwritten: changed content or a conflicting
email/payment/order causes the import to fail. Rows commit individually, so
interrupted imports can resume and a failure may follow earlier successful
inserts. A preview performs no writes; final database constraints are also
checked during the actual import.

There is one deliberate model-data correction: historical `razorpay` and
`stripe` rows were scored with unrelated replay samples. Imported payment rows
therefore have no model probability, ground truth, features, or model version;
they become `UNSCORED` / `pending_review` with reason
`unsupported_payment_features`. Existing `legit` review decisions remain
unflagged, and other payment rows remain flagged for review. Simulated rows keep
their original model data. The importer reports how many payment rows receive
this correction. The original source and its backup retain the previous data.
Old rows without a trustworthy test/live mode retain an unknown payment mode.
For all imported transactions, an existing human review decision determines the
current alert flag (`legit` clears it; `confirmed_fraud` sets it). This repairs
the older review endpoint's stale flag without changing simulated model scores.

Once cutover is verified, remove MongoDB credentials and the migration-only
dependency from the runtime environment. Preserve the old database/backup
according to your retention policy; the importer does not remove it.

## Backups and restore drills

Enable the PostgreSQL provider's automatic backups and point-in-time recovery
where available, and confirm the plan's retention, recovery window, and restore
permissions. Take an additional backup before a migration or application
cutover. Backups contain user password hashes and transaction data: restrict
access, encrypt stored copies, and keep them outside the repository.

For a portable logical backup, use PostgreSQL client tools compatible with the
server. Configure native libpq connection variables (`PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and the provider-required TLS settings), and authenticate
with a protected password file via `PGPASSFILE` or your secret manager. This
avoids putting the password in command arguments. Native tools do not accept the
SQLAlchemy-only `postgresql+psycopg://` scheme.

```text
pg_dump --format=custom --no-owner --no-acl --file=fraud-backup.dump
pg_restore --list fraud-backup.dump
```

Do a restore drill into a **new, empty, isolated database** owned by your restore
role. The following example assumes that database has already been created and
the libpq connection variables point to its host. No restore command should
target the live application database:

```text
pg_restore --dbname=fraud_restore_verify --no-owner --no-acl --exit-on-error fraud-backup.dump
```

The role needs permission to create objects in the target database's schema;
`--no-owner --no-acl` avoids requiring the original roles or superuser access.
If access is denied, use the provider's restore role or request those target
permissions; do not compensate by clearing the production schema. Configure an
isolated API with the restored database, check `/health`, compare record counts
and representative amounts, test login and merchant ownership, and confirm
webhook receipts remain durable. Disable outbound payment integrations during
the drill. Record restore time and validation results before considering a
backup usable.

The initial Alembic downgrade intentionally refuses to drop payment data. Roll
back application code only when schema-compatible, or restore a verified backup
to a separate database and perform a controlled cutover.

## Automated storage checks

```text
python -m unittest tests.test_storage -v
```

SQLite runs by default. To exercise real PostgreSQL, set `TEST_DATABASE_URL` to a
disposable test database and run the same command. Each PostgreSQL test creates
its own randomly named `storage_test_...` schema and removes only that schema.
The test role needs `CREATE` on the test database. Never point test configuration
at production. These tests cover committed migration parity and repeatability,
constraints, decimal amounts, UTC buckets, merchant scoping, review audit fields,
payment uniqueness, durable webhook receipts, and resumable MongoDB imports.
