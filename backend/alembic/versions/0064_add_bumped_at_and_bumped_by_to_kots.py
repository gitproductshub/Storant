"""add bumped at and bumped by to kots

Revision ID: 0064
Revises: 0063
Create Date: 2026-11-22 10:00:01.000000

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").

Existing tickets keep bumped_at = NULL; tickets an older build already bumped are status "served" and stay that way.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0064'
down_revision = '0063'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('kots', sa.Column('bumped_at', sa.DateTime(), nullable=True))
    op.add_column('kots', sa.Column('bumped_by', postgresql.UUID(as_uuid=True), nullable=True))


def downgrade() -> None:
    op.drop_column('kots', 'bumped_by')
    op.drop_column('kots', 'bumped_at')
