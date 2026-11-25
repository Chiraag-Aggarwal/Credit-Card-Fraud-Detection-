"""Preserve unique provider event IDs from legacy Stripe transactions."""

from alembic import op
import sqlalchemy as sa


revision = "0002_legacy_payment_ids"
down_revision = "0001_postgresql"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("transactions", sa.Column("stripe_event_id", sa.String(255), nullable=True))
    op.create_index("ix_transactions_stripe_event_id", "transactions", ["stripe_event_id"], unique=True)


def downgrade():
    raise RuntimeError("This migration preserves provider event IDs. Restore a verified backup to roll back.")
