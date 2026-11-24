"""Stock ledger. Stock on hand = sum of ``quantity_change`` per product (append-only, offline-merge friendly).
Every row is written by app.services.stock_service, which keeps products.stock_on_hand in step."""
from sqlalchemy import Column, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base, TENANT_RLS, TenantScoped, created_at_column, uuid_pk

class InventoryLog(TenantScoped, Base):
    __tablename__ = "inventory_logs"
    __table_args__ = (Index("ix_inventory_logs_tenant_product", "tenant_id", "product_id"), TENANT_RLS)

    id = uuid_pk()
    product_id = Column(UUID(as_uuid=True), ForeignKey("products.id"), nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey("locations.id"), nullable=False)
    quantity_change = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)  # sale, wastage, restock, adjustment, return
    note = Column(String, nullable=True)
    unit_cost = Column(Numeric(10, 2), nullable=True)
    order_id = Column(UUID(as_uuid=True), nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)  # staff member who changed stock (null: older rows, system)
    created_at = created_at_column()
