"""Sales reports. Ranges come from the client as timezone-aware datetimes (device local day)."""
from datetime import datetime
from decimal import Decimal
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.services.sales_window import (SOLD, average_bill, completed_filters, day_range as _range, hourly_sales, payment_split,
                                       staff_rows as _staff_rows, top_items)
from app.models import Order, OrderItem, Product, ProductCategory, InventoryLog, TenantUser, KOT

router = APIRouter(prefix="/reports", tags=["Reports"])

# "Today", "sold" and the staff numbers are shared with the Home dashboard (app.services.sales_window)

def _f(v) -> float:
    return float(v or 0)

@router.get("/summary")
async def sales_summary(date_from: datetime | None = None, date_to: datetime | None = None,
                        access: Access = Depends(require("reports.view", feature="reports")), db: AsyncSession = Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    start, end = _range(date_from, date_to)
    base = [Order.tenant_id == tenant_id, Order.created_at >= start, Order.created_at < end]
    done = completed_filters(tenant_id, start, end)

    totals = (await db.execute(select(
        func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0), func.coalesce(func.sum(Order.subtotal), 0),
        func.coalesce(func.sum(Order.tax_amount), 0), func.coalesce(func.sum(Order.discount_amount), 0),
        func.coalesce(func.sum(Order.commission_amount), 0), func.coalesce(func.sum(Order.round_off), 0),
    ).where(*done))).one()
    count, gross, net, tax, discount, commission, round_off = totals
    cancelled = (await db.execute(select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                                  .where(*base, Order.status == "cancelled"))).one()
    open_orders = (await db.execute(select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                                    .where(Order.tenant_id == tenant_id, Order.status.in_(["open", "placed"])))).one()

    by_payment = await payment_split(db, tenant_id, start, end)
    by_channel = (await db.execute(select(Order.channel, func.count(Order.id), func.sum(Order.total_amount), func.sum(Order.commission_amount))
                                   .where(*done).group_by(Order.channel))).all()
    by_type = (await db.execute(select(Order.type, func.count(Order.id), func.sum(Order.total_amount)).where(*done).group_by(Order.type))).all()

    hourly = await hourly_sales(db, tenant_id, start, end)
    best = await top_items(db, tenant_id, start, end, limit=10)
    by_category = (await db.execute(
        select(func.coalesce(ProductCategory.name, "Uncategorised"), func.sum(OrderItem.quantity), func.sum(OrderItem.subtotal))
        .join(Order, Order.id == OrderItem.order_id).join(Product, Product.id == OrderItem.product_id)
        .outerjoin(ProductCategory, ProductCategory.id == Product.category_id).where(*done, SOLD)
        .group_by(ProductCategory.name).order_by(desc(func.sum(OrderItem.subtotal)))
    )).all()

    count = int(count)
    return {
        "from": start.isoformat() + "Z", "to": end.isoformat() + "Z",
        "orders": count, "gross_sales": _f(gross), "net_sales": _f(Decimal(net) - Decimal(discount)), "tax": _f(tax),
        "discounts": _f(discount), "commission": _f(commission), "round_off": _f(round_off),
        "average_order_value": average_bill(gross, count),
        "cancelled_orders": int(cancelled[0]), "cancelled_value": _f(cancelled[1]),
        "open_orders": int(open_orders[0]), "open_value": _f(open_orders[1]),
        "by_payment": by_payment,
        "by_channel": [{"channel": ch, "orders": int(c), "amount": _f(a), "commission": _f(cm), "net": _f(Decimal(a or 0) - Decimal(cm or 0))}
                       for ch, c, a, cm in by_channel],
        "by_type": [{"type": t, "orders": int(c), "amount": _f(a)} for t, c, a in by_type],
        "hourly": hourly,
        "top_items": best,
        "by_category": [{"category": n, "quantity": int(q or 0), "revenue": _f(r)} for n, q, r in by_category],
    }

@router.get("/items")
async def item_sales(date_from: datetime | None = None, date_to: datetime | None = None,
                     access: Access = Depends(require("reports.view", feature="advanced_reports")), db: AsyncSession = Depends(get_tenant_db)):
    start, end = _range(date_from, date_to)
    rows = (await db.execute(
        select(OrderItem.name, OrderItem.variant_name, func.sum(OrderItem.quantity), func.sum(OrderItem.subtotal), func.sum(OrderItem.tax_amount))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.tenant_id == access.tenant_id, Order.status == "completed", Order.archived_at.is_(None), Order.created_at >= start, Order.created_at < end, SOLD)
        .group_by(OrderItem.name, OrderItem.variant_name).order_by(desc(func.sum(OrderItem.subtotal)))
    )).all()
    return [{"name": n, "variant": v, "quantity": int(q or 0), "revenue": _f(r), "tax": _f(t)} for n, v, q, r, t in rows]

@router.get("/wastage")
async def wastage(date_from: datetime | None = None, date_to: datetime | None = None,
                  access: Access = Depends(require("reports.view", feature="advanced_reports")), db: AsyncSession = Depends(get_tenant_db)):
    start, end = _range(date_from, date_to)
    rows = (await db.execute(
        select(Product.name, func.sum(InventoryLog.quantity_change), func.sum(-InventoryLog.quantity_change * func.coalesce(Product.cost_price, 0)))
        .join(Product, Product.id == InventoryLog.product_id)
        .where(InventoryLog.tenant_id == access.tenant_id, InventoryLog.reason == "wastage",
               InventoryLog.created_at >= start, InventoryLog.created_at < end)
        .group_by(Product.name)
    )).all()
    return [{"product": n, "quantity": abs(int(q or 0)), "cost": _f(c)} for n, q, c in rows]

@router.get("/staff")
async def staff_performance(date_from: datetime | None = None, date_to: datetime | None = None,
                            access: Access = Depends(require("reports.view", "staff.view", feature="advanced_reports")),
                            db: AsyncSession = Depends(get_tenant_db)):
    """Per staff member: orders taken (waiter), sales, average bill, tables & covers served, items, bills settled, cancellations."""
    start, end = _range(date_from, date_to)
    return await _staff_rows(db, access.tenant_id, start, end)

@router.get("/me")
async def my_performance(date_from: datetime | None = None, date_to: datetime | None = None,
                         access: Access = Depends(require("reports.view_own", "reports.view", any_of=True)),
                         db: AsyncSession = Depends(get_tenant_db)):
    """A staff member's own numbers (waiters/cashiers see their day without seeing the whole business)."""
    start, end = _range(date_from, date_to)
    rows = await _staff_rows(db, access.tenant_id, start, end, only=access.staff_id)
    return rows[0] if rows else {"staff_id": access.staff_id, "name": access.staff_name, "orders": 0, "sales": 0.0, "average_bill": 0.0,
                                 "tables_served": 0, "covers": 0, "items": 0, "bills_settled": 0, "collected": 0.0, "cancelled": 0}
