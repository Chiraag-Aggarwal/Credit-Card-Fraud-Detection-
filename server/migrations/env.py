"""Alembic environment: application URLs never pass through logging/config files."""

import os

from alembic import context
from app.storage import Base, database_engine


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


connection = context.config.attributes.get("connection")
if connection is not None:
    migrate(connection)
else:
    engine = database_engine(os.getenv("DATABASE_URL", ""))
    try:
        with engine.begin() as connection:
            # Serialize concurrent deploy migration commands on PostgreSQL.
            connection.exec_driver_sql("SELECT pg_advisory_xact_lock(746278313)")
            migrate(connection)
    finally:
        engine.dispose()
