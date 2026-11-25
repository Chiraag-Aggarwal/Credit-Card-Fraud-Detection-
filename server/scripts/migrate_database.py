"""Apply committed schema migrations using DATABASE_URL, without printing secrets."""

import os
from pathlib import Path
import sys

SERVER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_ROOT))

from alembic import command
from alembic.config import Config
from dotenv import load_dotenv
from app.storage import database_engine


def upgrade_database(database_url: str, *, allow_sqlite: bool = False) -> None:
    engine = database_engine(database_url, allow_sqlite=allow_sqlite)
    config = Config(str(SERVER_ROOT / "alembic.ini"))
    try:
        with engine.begin() as connection:
            if engine.dialect.name == "postgresql":
                connection.exec_driver_sql("SELECT pg_advisory_xact_lock(746278313)")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    finally:
        engine.dispose()


def main() -> int:
    load_dotenv(SERVER_ROOT / ".env")
    try:
        upgrade_database(os.getenv("DATABASE_URL", ""))
    except Exception as error:
        print(f"Database migration failed ({type(error).__name__}); check database access and configuration.", file=sys.stderr)
        return 1
    print("Database migrations applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
