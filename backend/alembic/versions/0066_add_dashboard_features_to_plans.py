"""add dashboard features to plans

Revision ID: 0066
Revises: 0065
Create Date: 2026-11-24 10:00:00.000000

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").

Data only, `plans` table only. The Home dashboard's extras are two new plan features (app.core.catalog.FEATURES):
- dashboard_insights: payment split, hourly sales, top items, voids & comps
- dashboard_live: table waiting times and kitchen delays
The basic dashboard needs no feature (every plan has it). Plan rows saved before this migration don't list the new keys,
so the default plans get them here, like app.core.catalog.DEFAULT_PLANS: Pro both, Standard dashboard_live, Basic none.
Other (super admin made) plans are left alone: the super admin decides. Idempotent: a key already there isn't added twice.
Downgrade removes the two keys from every plan.
"""
import json
from alembic import op
import sqlalchemy as sa

revision = '0066'
down_revision = '0065'
branch_labels = None
depends_on = None

INSIGHTS, LIVE = "dashboard_insights", "dashboard_live"
ADD_BY_PLAN = {"pro": (INSIGHTS, LIVE), "standard": (LIVE,)}


def _rows(bind):
    return bind.execute(sa.text("SELECT key, features FROM plans")).fetchall()


def _features(raw) -> list:
    if isinstance(raw, str):
        raw = json.loads(raw)
    return list(raw or [])


def _save(bind, key, features: list) -> None:
    bind.execute(sa.text("UPDATE plans SET features = CAST(:f AS json) WHERE key = :k"), {"f": json.dumps(sorted(set(features))), "k": key})


def upgrade() -> None:
    bind = op.get_bind()
    for key, raw in _rows(bind):
        features = _features(raw)
        missing = [f for f in ADD_BY_PLAN.get(key, ()) if f not in features]
        if missing:
            _save(bind, key, features + missing)


def downgrade() -> None:
    bind = op.get_bind()
    for key, raw in _rows(bind):
        features = _features(raw)
        kept = [f for f in features if f not in (INSIGHTS, LIVE)]
        if kept != features:
            _save(bind, key, kept)
