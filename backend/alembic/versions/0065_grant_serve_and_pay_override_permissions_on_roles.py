"""grant kitchen.serve and orders.pay_override on roles

Revision ID: 0065
Revises: 0064
Create Date: 2026-11-22 10:00:02.000000

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").

Data only. Roles without a row use app.core.catalog.SYSTEM_ROLES and get the new permissions from there. Saved role rows
(built-in roles an owner edited, and custom roles) get them here:
- kitchen.serve ("Mark items served"): manager, cashier, waiter, and custom roles that take orders or payments.
  Never the kitchen role: the kitchen readies food, floor staff serve it.
- orders.pay_override ("Take payment before items are served"): manager.
"""
import json
from alembic import op
import sqlalchemy as sa

revision = '0065'
down_revision = '0064'
branch_labels = None
depends_on = None

SERVE, OVERRIDE = "kitchen.serve", "orders.pay_override"
SERVE_ROLES = {"manager", "cashier", "waiter"}


def _rows(bind):
    return bind.execute(sa.text("SELECT id, key, is_system, permissions FROM roles")).fetchall()


def _perms(raw) -> list:
    if isinstance(raw, str):
        raw = json.loads(raw)
    return list(raw or [])


def _save(bind, role_id, perms: list) -> None:
    bind.execute(sa.text("UPDATE roles SET permissions = CAST(:p AS json) WHERE id = :id"), {"p": json.dumps(perms), "id": role_id})


def upgrade() -> None:
    bind = op.get_bind()
    for role_id, key, is_system, raw in _rows(bind):
        perms = _perms(raw)
        if key == "owner" or key == "kitchen":
            continue  # owners always have everything; the kitchen never serves
        before = list(perms)
        takes_orders = "orders.create" in perms or "orders.pay" in perms
        if SERVE not in perms and (key in SERVE_ROLES or (not is_system and takes_orders)):
            perms.append(SERVE)
        if key == "manager" and OVERRIDE not in perms:
            perms.append(OVERRIDE)
        if perms != before:
            _save(bind, role_id, perms)


def downgrade() -> None:
    bind = op.get_bind()
    for role_id, _key, _is_system, raw in _rows(bind):
        perms = _perms(raw)
        kept = [p for p in perms if p not in (SERVE, OVERRIDE)]
        if kept != perms:
            _save(bind, role_id, kept)
