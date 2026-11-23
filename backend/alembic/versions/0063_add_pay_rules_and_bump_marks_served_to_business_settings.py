"""add pay rules and bump marks served to business_settings

Revision ID: 0063
Revises: 0062
Create Date: 2026-11-22 10:00:00.000000

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").

pay_rules stays NULL for existing businesses: the code fills in the defaults (dine-in after served, everything else
anytime), so every business gets them without a backfill.
"""
from alembic import op
import sqlalchemy as sa

revision = '0063'
down_revision = '0062'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('business_settings', sa.Column('pay_rules', sa.JSON(), nullable=True))
    op.add_column('business_settings', sa.Column('bump_marks_served', sa.Boolean(), server_default='false', nullable=False))


def downgrade() -> None:
    op.drop_column('business_settings', 'bump_marks_served')
    op.drop_column('business_settings', 'pay_rules')
