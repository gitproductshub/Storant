"""add stock counter, held bill lines, stock change author and sell-at-zero setting

Revision ID: 0067
Revises: 0066
Create Date: 2026-11-24 18:00:00.000000

Rules: forward-only and non-destructive (old app versions must keep working against the new schema);
new tenant tables need Row-Level Security — autogenerate adds it, for hand-written ones use
app.db.rls.enable_tenant_rls("table") / enable_child_rls("table", "fk_column", "parent_table").

Sold-out items and "N left" (docs/features/007_Inventory_Management.md, "Stock counter"). One file on purpose (agreed
with the owner); every table keeps its existing RLS policy, only columns / one index are added:

- products.stock_on_hand: the counter kept next to the stock ledger (inventory_logs). NULL = never counted (tracked
  items without any stock entry of their own never become sold out). Backfill: tracked products that have at least one
  stock entry made by hand (a ledger row without a bill: opening stock, stock in / out, wastage, adjustment) get the
  ledger sum. Idempotent: only rows that are still NULL are filled.
- order_items.stock_held: the line's stock was taken when it was saved on the bill. Existing lines are false, so bills
  that were open before this change cut stock at payment exactly as before (never twice).
- inventory_logs.created_by: the staff member who changed stock (NULL for older rows and system changes), and an index
  on (tenant_id, product_id) for a product's history and the counter check.
- business_settings.allow_sell_at_zero: false for every business (blocking is on).

Downgrade removes all of it (the ledger itself is untouched, so no stock information is lost).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0067'
down_revision = '0066'
branch_labels = None
depends_on = None

INDEX = "ix_inventory_logs_tenant_product"


def _has_column(table: str, column: str) -> bool:
    return any(c["name"] == column for c in sa.inspect(op.get_bind()).get_columns(table))


def _has_index(table: str, name: str) -> bool:
    return any(i["name"] == name for i in sa.inspect(op.get_bind()).get_indexes(table))


def upgrade() -> None:
    if not _has_column("products", "stock_on_hand"):
        op.add_column("products", sa.Column("stock_on_hand", sa.Integer(), nullable=True))
    if not _has_column("order_items", "stock_held"):
        op.add_column("order_items", sa.Column("stock_held", sa.Boolean(), server_default=sa.text("false"), nullable=False))
    if not _has_column("inventory_logs", "created_by"):
        op.add_column("inventory_logs", sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True))
    if not _has_index("inventory_logs", INDEX):
        op.create_index(INDEX, "inventory_logs", ["tenant_id", "product_id"], unique=False)
    if not _has_column("business_settings", "allow_sell_at_zero"):
        op.add_column("business_settings", sa.Column("allow_sell_at_zero", sa.Boolean(), server_default=sa.text("false"), nullable=False))

    # Backfill the counter (idempotent: only products still NULL). Runs as the migration user, so RLS doesn't filter rows.
    op.execute("""
        UPDATE products AS p
           SET stock_on_hand = totals.total
          FROM (SELECT tenant_id, product_id, SUM(quantity_change) AS total
                  FROM inventory_logs
                 GROUP BY tenant_id, product_id) AS totals
         WHERE p.id = totals.product_id
           AND p.tenant_id = totals.tenant_id
           AND p.track_stock = true
           AND p.stock_on_hand IS NULL
           AND EXISTS (SELECT 1 FROM inventory_logs AS manual
                        WHERE manual.product_id = p.id AND manual.tenant_id = p.tenant_id AND manual.order_id IS NULL)
    """)


def downgrade() -> None:
    if _has_column("business_settings", "allow_sell_at_zero"):
        op.drop_column("business_settings", "allow_sell_at_zero")
    if _has_index("inventory_logs", INDEX):
        op.drop_index(INDEX, table_name="inventory_logs")
    if _has_column("inventory_logs", "created_by"):
        op.drop_column("inventory_logs", "created_by")
    if _has_column("order_items", "stock_held"):
        op.drop_column("order_items", "stock_held")
    if _has_column("products", "stock_on_hand"):
        op.drop_column("products", "stock_on_hand")
