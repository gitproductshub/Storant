"""Shared sales rules for Reports and the Home dashboard, so both always show the same figures.

- "Today" is midnight to midnight in the business timezone (India), stored as UTC.
- A sale is a completed bill that the platform hasn't archived; void / removed lines were never sold.
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from sqlalchemy import desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.config import settings as app_settings
from app.models import Order, OrderItem, Payment

# Cancelled (void) lines stay on bills for the record but were never sold
SOLD = func.coalesce(OrderItem.kitchen_status, "").notin_(["void", "removed"])


def money(v) -> float:
    return float(v or 0)


def day_range(date_from: datetime | None = None, date_to: datetime | None = None) -> tuple[datetime, datetime]:
    """UTC-naive [start, end). Defaults to today in the business timezone."""
    tz = ZoneInfo(app_settings.TIMEZONE)
    if date_from is None:
        local_start = datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
        date_from = local_start
    if date_to is None:
        date_to = date_from + timedelta(days=1)

    def to_utc(v: datetime) -> datetime:
        if v.tzinfo is None:
            v = v.replace(tzinfo=tz)
        return (v - v.utcoffset()).replace(tzinfo=None)
    return to_utc(date_from), to_utc(date_to)


def completed_filters(tenant_id, start: datetime, end: datetime) -> list:
    """Bills that count as sales in [start, end)."""
    return [Order.tenant_id == tenant_id, Order.created_at >= start, Order.created_at < end,
            Order.status == "completed", Order.archived_at.is_(None)]


def average_bill(gross, count: int) -> float:
    return round(money(gross) / count, 2) if count else 0.0


async def sales_headline(db: AsyncSession, tenant_id, start: datetime, end: datetime) -> dict:
    """Bills, gross sales and average bill: the same numbers as the top of the Reports screen."""
    count, gross = (await db.execute(select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                                     .where(*completed_filters(tenant_id, start, end)))).one()
    count = int(count)
    return {"orders": count, "gross_sales": money(gross), "average_order_value": average_bill(gross, count)}


async def payment_split(db: AsyncSession, tenant_id, start: datetime, end: datetime) -> list[dict]:
    """Takings by payment method (Reports → Payments)."""
    rows = (await db.execute(select(Payment.method, func.sum(Payment.amount), func.count(Payment.id))
                             .join(Order, Order.id == Payment.order_id).where(*completed_filters(tenant_id, start, end))
                             .group_by(Payment.method))).all()
    return [{"method": m, "amount": money(a), "count": int(c)} for m, a, c in rows]


async def hourly_sales(db: AsyncSession, tenant_id, start: datetime, end: datetime) -> list[float]:
    """Sales per local hour of the day, 0–23 (Reports → Sales by hour)."""
    tz = ZoneInfo(app_settings.TIMEZONE)
    hourly = [0.0] * 24
    for created_at, total in (await db.execute(select(Order.created_at, Order.total_amount)
                                               .where(*completed_filters(tenant_id, start, end)))).all():
        local = created_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
        hourly[local.hour] += float(total)
    return [round(v, 2) for v in hourly]


async def top_items(db: AsyncSession, tenant_id, start: datetime, end: datetime, limit: int = 10) -> list[dict]:
    """Best sellers by revenue (Reports → Top items)."""
    rows = (await db.execute(
        select(OrderItem.name, func.sum(OrderItem.quantity).label("qty"), func.sum(OrderItem.subtotal).label("revenue"))
        .join(Order, Order.id == OrderItem.order_id).where(*completed_filters(tenant_id, start, end), SOLD)
        .group_by(OrderItem.name).order_by(desc("revenue")).limit(limit)
    )).all()
    return [{"name": n, "quantity": int(q or 0), "revenue": money(r)} for n, q, r in rows]


async def staff_rows(db: AsyncSession, tenant_id: str, start, end, only=None) -> list[dict]:
    """Per staff member: orders taken (waiter), sales, average bill, tables & covers served, items, bills settled, cancellations."""
    from app.models import TenantUser, TableEntity
    window = [Order.tenant_id == tenant_id, Order.created_at >= start, Order.created_at < end]
    taken_q = (select(Order.waiter_id, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0),
                      func.count(func.distinct(Order.table_id)))
               .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.waiter_id.isnot(None)).group_by(Order.waiter_id))
    covers_q = (select(Order.waiter_id, func.coalesce(func.sum(TableEntity.capacity), 0))
                .join(TableEntity, TableEntity.id == Order.table_id)
                .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.waiter_id.isnot(None)).group_by(Order.waiter_id))
    items_q = (select(Order.waiter_id, func.coalesce(func.sum(OrderItem.quantity), 0)).join(OrderItem, OrderItem.order_id == Order.id)
               .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.waiter_id.isnot(None), SOLD).group_by(Order.waiter_id))
    settled_q = (select(Order.settled_by, func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                 .where(*window, Order.status == "completed", Order.archived_at.is_(None), Order.settled_by.isnot(None)).group_by(Order.settled_by))
    cancelled_q = (select(Order.waiter_id, func.count(Order.id)).where(*window, Order.status == "cancelled", Order.waiter_id.isnot(None))
                   .group_by(Order.waiter_id))
    if only:
        taken_q, covers_q, items_q = taken_q.where(Order.waiter_id == only), covers_q.where(Order.waiter_id == only), items_q.where(Order.waiter_id == only)
        settled_q, cancelled_q = settled_q.where(Order.settled_by == only), cancelled_q.where(Order.waiter_id == only)
    taken = {r[0]: r for r in (await db.execute(taken_q)).all()}
    covers = dict((await db.execute(covers_q)).all())
    items = dict((await db.execute(items_q)).all())
    settled = {r[0]: r for r in (await db.execute(settled_q)).all()}
    cancelled = dict((await db.execute(cancelled_q)).all())
    ids = set(taken) | set(settled) | set(cancelled)
    staff_q = select(TenantUser).where(TenantUser.tenant_id == tenant_id)
    staff = {s.id: s for s in (await db.execute(staff_q)).scalars().all()}
    rows = []
    for sid in ids:
        member = staff.get(sid)
        _, orders, sales, tables = taken.get(sid, (sid, 0, 0, 0))
        _, settled_count, collected = settled.get(sid, (sid, 0, 0))
        rows.append({
            "staff_id": str(sid), "name": (member.full_name or member.username) if member else "Former staff",
            "role": member.role if member else None, "orders": int(orders), "sales": money(sales),
            "average_bill": round(money(sales) / int(orders), 2) if orders else 0.0, "tables_served": int(tables),
            "covers": int(covers.get(sid, 0)), "items": int(items.get(sid, 0)), "bills_settled": int(settled_count),
            "collected": money(collected), "cancelled": int(cancelled.get(sid, 0)),
        })
    return sorted(rows, key=lambda r: -r["sales"])


async def my_numbers(db: AsyncSession, tenant_id: str, start, end, staff_id: str | None, staff_name: str | None) -> dict:
    """One staff member's row (zeros when they have nothing yet), as on Reports → My day. A login with no staff record
    (staff_id None) gets zeros, never somebody else's row."""
    rows = await staff_rows(db, tenant_id, start, end, only=staff_id) if staff_id else []
    return rows[0] if rows else {"staff_id": staff_id, "name": staff_name, "orders": 0, "sales": 0.0, "average_bill": 0.0,
                                 "tables_served": 0, "covers": 0, "items": 0, "bills_settled": 0, "collected": 0.0, "cancelled": 0}
