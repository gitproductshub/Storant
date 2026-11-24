"""Home dashboard: which widgets a person gets, and their data.

Widgets are chosen from PERMISSIONS (never from role names), the business's plan features (modules and dashboard
keys) and its business type. The role only decides the order and the selection that fits the job ("persona"); custom
roles get a persona from their permissions. Everything is checked and money is removed here, on the server; the app
shows what it gets.

Every widget declares its plan feature key: `BASIC` (None) means the basic dashboard every plan has; later widgets use
"dashboard_insights" or "dashboard_live" (app.core.catalog.FEATURES), and more keys can be added the same way.

"Today", "sold" and the staff numbers come from app.services.sales_window, the same helpers Reports uses.
Results are cached for a few seconds per business (per person for "my" widgets) in app.services.dashboard_cache.
"""
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Awaitable, Callable
from sqlalchemy import desc, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.models import KOT, Order, OrderItem, Payment, TableEntity
from app.services.access import Access
from app.services.dashboard_cache import get_or_compute
from app.services.order_service import OPEN_STATUSES, is_void, pay_gate
from app.services.sales_window import (completed_filters, day_range, hourly_sales, money, my_numbers, payment_split, sales_headline,
                                       top_items)
from app.services.settings_service import get_settings

logger = logging.getLogger("tallyko")

BASIC = None  # plan feature of the basic dashboard: every plan has it
INSIGHTS = "dashboard_insights"  # payment split, hourly sales, top items, voids & comps
LIVE = "dashboard_live"  # table waiting times, kitchen delays
RESTAURANTS = ("restaurant", "cafe")  # dine-in tables
KITCHENS = ("restaurant", "cafe", "cloud_kitchen")
MONEY_PERMISSIONS = ("reports.view", "orders.pay")  # may see ₹ amounts on Home


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() + "Z" if dt else None


def _sees_money(access: Access) -> bool:
    return any(access.can(p) for p in MONEY_PERMISSIONS)


def _staff_uuid(access: Access) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(access.staff_id)) if access.staff_id else None
    except ValueError:
        return None


@dataclass
class Ctx:
    db: AsyncSession
    access: Access
    business_type: str
    settings: Any
    start: datetime
    end: datetime
    _open_orders: list | None = field(default=None, repr=False)

    @property
    def tenant_id(self) -> str:
        return self.access.tenant_id

    async def open_orders(self) -> list[Order]:
        """Running bills (open, or online orders waiting to be accepted), oldest first. Loaded once per request."""
        if self._open_orders is None:
            self._open_orders = list((await self.db.execute(
                select(Order).where(Order.tenant_id == self.tenant_id, Order.status.in_(OPEN_STATUSES), Order.archived_at.is_(None))
                .order_by(Order.created_at))).scalars().all())
        return self._open_orders

    async def table_labels(self, ids) -> dict:
        ids = {i for i in ids if i}
        if not ids:
            return {}
        rows = await self.db.execute(select(TableEntity.id, TableEntity.table_number)
                                     .where(TableEntity.tenant_id == self.tenant_id, TableEntity.id.in_(ids)))
        return dict(rows.all())


@dataclass(frozen=True)
class Widget:
    key: str
    permissions: tuple[str, ...]        # needs any one of these
    plan_feature: str | None            # BASIC, or a dashboard plan key such as "dashboard_insights"
    compute: Callable[[Ctx], Awaitable[dict]]
    module: str | None = None           # business module that must be on (e.g. "tables")
    business_types: tuple[str, ...] | None = None  # None = every business type
    refresh: int = 30                   # seconds between refreshes in the app
    ttl: int = 10                       # seconds the server keeps the result
    per_staff: bool = False             # about the signed-in person (cached per person)
    shape: Callable[[dict, Access], dict] | None = None  # per-person view of the cached data (removes money etc.)


# --- Widget data -----------------------------------------------------------------------------------------------------

async def _today_sales(ctx: Ctx) -> dict:
    return await sales_headline(ctx.db, ctx.tenant_id, ctx.start, ctx.end)


async def _open_bills(ctx: Ctx) -> dict:
    orders = await ctx.open_orders()
    tables_total = (await ctx.db.execute(select(func.count(TableEntity.id))
                                         .where(TableEntity.tenant_id == ctx.tenant_id, TableEntity.is_active == True))).scalar() or 0  # noqa: E712
    return {
        "count": len(orders), "value": round(sum(money(o.total_amount) for o in orders), 2),
        "online_waiting": sum(1 for o in orders if o.status == "placed"),
        "tables_occupied": len({o.table_id for o in orders if o.table_id and o.status == "open"}), "tables_total": int(tables_total),
        "oldest_at": _iso(orders[0].created_at) if orders else None,
    }


def _shape_open_bills(data: dict, access: Access) -> dict:
    out = dict(data)
    if not _sees_money(access):
        out.pop("value", None)
    if not (access.can("tables.view") and access.has("tables")):
        out.pop("tables_occupied", None)
        out.pop("tables_total", None)
    return out


async def _payment_claims(ctx: Ctx) -> dict:
    orders = [o for o in await ctx.open_orders() if isinstance(o.payment_claim, dict) and o.payment_claim]
    labels = await ctx.table_labels(o.table_id for o in orders)
    bills = sorted(({"order_id": str(o.id), "code": o.code, "table_label": labels.get(o.table_id), "bill_label": o.bill_label,
                     "method": o.payment_claim.get("method"), "amount": money(o.payment_claim.get("amount")),
                     "at": o.payment_claim.get("at")} for o in orders), key=lambda b: b["at"] or "")
    return {"count": len(bills), "bills": bills[:5]}


async def _ready_to_pay(ctx: Ctx) -> dict:
    """Dine-in bills whose food passes the owner's pay rule (same check as taking payment), oldest first."""
    rows = (await ctx.db.execute(
        select(Order).options(selectinload(Order.items))
        .where(Order.tenant_id == ctx.tenant_id, Order.status == "open", Order.type == "DINE_IN", Order.payment_status != "paid",
               Order.archived_at.is_(None))
        .order_by(Order.created_at))).scalars().all()
    kitchen_on = ctx.access.has("kitchen")
    ready = []
    for order in rows:
        if not any(not is_void(i) for i in order.items):
            continue  # nothing on the bill yet
        if kitchen_on and (await pay_gate(ctx.db, ctx.tenant_id, order, ctx.settings))["blocking"] > 0:
            continue
        ready.append(order)
    labels = await ctx.table_labels(o.table_id for o in ready)
    return {
        "count": len(ready), "value": round(sum(money(o.total_amount) for o in ready), 2),
        "bills": [{"order_id": str(o.id), "code": o.code, "table_label": labels.get(o.table_id), "bill_label": o.bill_label,
                   "total": money(o.total_amount), "since": _iso(o.created_at)} for o in ready[:5]],
    }


async def _low_stock(ctx: Ctx) -> dict:
    """Low and sold-out items from the stock counter (the same rows as Inventory), and today's orders that were
    accepted short on stock (delivery apps, offline bills)."""
    from app.api.inventory import _stock_levels
    from app.models import AuditLog
    rows = await _stock_levels(ctx.db, ctx.tenant_id)
    short = (await ctx.db.execute(select(func.count(AuditLog.id)).where(
        AuditLog.tenant_id == ctx.tenant_id, AuditLog.action == "stock.short", AuditLog.created_at >= ctx.start,
        AuditLog.created_at < ctx.end))).scalar() or 0
    return {"count": sum(1 for r in rows if r["is_low"]), "out": sum(1 for r in rows if r["sold_out"]),
            "uncounted": sum(1 for r in rows if not r["counted"]), "short_orders": int(short)}


async def _ready_to_serve(ctx: Ctx) -> dict:
    from app.api.tables import ready_to_serve  # the list behind the floor's voice alerts
    result = await ready_to_serve(access=ctx.access, db=ctx.db)
    return {"server_time": result["server_time"], "items": result["items"]}


def _shape_ready_to_serve(data: dict, access: Access) -> dict:
    me = str(access.staff_id) if access.staff_id else None
    items = data.get("items") or []
    is_mine = (lambda i: bool(me) and me in (i.get("assigned_staff_id"), i.get("waiter_id")))
    mine = [i for i in items if is_mine(i)]
    others = [i for i in items if not is_mine(i)]
    since = [i["ready_since"] for i in items if i.get("ready_since")]
    return {
        "count": len(items), "mine": len(mine), "oldest_ready_since": min(since) if since else None, "server_time": data.get("server_time"),
        "items": [{"order_id": i["order_id"], "table_id": i["table_id"], "table_label": i["table_label"], "bill_label": i.get("bill_label"),
                   "kot_no": i.get("kot_no"), "ready_count": i["ready_count"], "ready_since": i.get("ready_since"), "mine": is_mine(i)}
                  for i in (mine + others)[:6]],
    }


def _natural(label: str):
    """Sort key: table 2 before table 10."""
    digits = "".join(c for c in label if c.isdigit())
    return (int(digits) if digits else 10**9, label)


async def _my_tables(ctx: Ctx) -> dict:
    me = _staff_uuid(ctx.access)
    empty = {"assigned": 0, "running": 0, "tables": []}
    if me is None:
        return empty
    tables = (await ctx.db.execute(select(TableEntity).where(TableEntity.tenant_id == ctx.tenant_id, TableEntity.is_active == True)  # noqa: E712
                                   )).scalars().all()
    running = [o for o in await ctx.open_orders() if o.table_id and o.status == "open"]
    assigned = {t.id for t in tables if t.assigned_staff_id == me}
    mine_ids = assigned | {o.table_id for o in running if o.waiter_id == me}
    if not mine_ids:
        return empty
    bills = [o for o in running if o.table_id in mine_ids]
    counts: dict = {}
    if bills:
        rows = await ctx.db.execute(
            select(OrderItem.order_id, OrderItem.kitchen_status, func.coalesce(func.sum(OrderItem.quantity), 0))
            .where(OrderItem.order_id.in_([o.id for o in bills]), OrderItem.kitchen_status.isnot(None),
                   OrderItem.kitchen_status.notin_(["void", "removed"]))
            .group_by(OrderItem.order_id, OrderItem.kitchen_status))
        for order_id, status, qty in rows.all():
            counts.setdefault(order_id, {})[status] = counts.get(order_id, {}).get(status, 0) + int(qty)
    out = []
    for t in tables:
        if t.id not in mine_ids:
            continue
        on_table = [o for o in bills if o.table_id == t.id]
        kitchen = {"pending": 0, "preparing": 0, "ready": 0, "served": 0}
        for o in on_table:
            for status, qty in counts.get(o.id, {}).items():
                if status in kitchen:
                    kitchen[status] += qty
        out.append({"table_id": str(t.id), "label": t.table_number, "section": t.section, "assigned": t.id in assigned,
                    "bills": len(on_table), "since": _iso(min((o.created_at for o in on_table), default=None)), "kitchen": kitchen})
    out.sort(key=lambda r: (not r["bills"], -r["kitchen"]["ready"], _natural(r["label"])))
    return {"assigned": len(assigned), "running": sum(1 for r in out if r["bills"]), "tables": out[:12]}


async def _my_day(ctx: Ctx) -> dict:
    row = await my_numbers(ctx.db, ctx.tenant_id, ctx.start, ctx.end, ctx.access.staff_id, ctx.access.staff_name)
    keys = ("orders", "tables_served", "covers", "items", "bills_settled", "cancelled", "sales", "collected", "average_bill")
    return {k: row.get(k, 0) for k in keys}


def _shape_my_day(data: dict, access: Access) -> dict:
    if access.can("orders.pay"):
        return data
    # Waiters (and anyone who can't take payments) see counts only on Home
    return {k: v for k, v in data.items() if k not in ("sales", "collected", "average_bill")}


async def _my_collection(ctx: Ctx) -> dict:
    """Today's bills this person settled, by payment method (Reports' payment split, for one cashier)."""
    me = _staff_uuid(ctx.access)
    if me is None:
        return {"total": 0.0, "count": 0, "by_method": []}
    rows = (await ctx.db.execute(
        select(Payment.method, func.coalesce(func.sum(Payment.amount), 0), func.count(Payment.id))
        .join(Order, Order.id == Payment.order_id)
        .where(*completed_filters(ctx.tenant_id, ctx.start, ctx.end), Order.settled_by == me)
        .group_by(Payment.method))).all()
    by_method = sorted(({"method": m, "amount": money(a), "count": int(c)} for m, a, c in rows), key=lambda r: -r["amount"])
    return {"total": round(sum(r["amount"] for r in by_method), 2), "count": sum(r["count"] for r in by_method), "by_method": by_method}


async def _kitchen(ctx: Ctx) -> dict:
    """Tickets on the kitchen screen (not bumped), the oldest one still cooking, and what to cook next."""
    active = [KOT.tenant_id == ctx.tenant_id, KOT.status.in_(["pending", "preparing", "ready"]), KOT.bumped_at.is_(None)]
    counts = dict((await ctx.db.execute(select(KOT.status, func.count(KOT.id)).where(*active).group_by(KOT.status))).all())
    cooking = [*active, KOT.status.in_(["pending", "preparing"])]
    oldest = (await ctx.db.execute(select(func.min(KOT.created_at)).where(*cooking))).scalar()
    qty = func.coalesce(func.sum(OrderItem.quantity), 0)
    items = (await ctx.db.execute(
        select(OrderItem.name, OrderItem.variant_name, qty).join(KOT, KOT.id == OrderItem.kot_id)
        .where(*cooking, func.coalesce(OrderItem.kitchen_status, "pending").in_(["pending", "preparing"]))
        .group_by(OrderItem.name, OrderItem.variant_name).order_by(desc(qty), OrderItem.name).limit(8))).all()
    return {
        "pending": int(counts.get("pending", 0)), "preparing": int(counts.get("preparing", 0)), "ready": int(counts.get("ready", 0)),
        "oldest_at": _iso(oldest), "to_prepare": [{"name": n, "variant": v, "quantity": int(q)} for n, v, q in items],
    }


# --- Insights (plan feature "dashboard_insights") ---------------------------------------------------------------------

async def _payment_split(ctx: Ctx) -> dict:
    rows = sorted(await payment_split(ctx.db, ctx.tenant_id, ctx.start, ctx.end), key=lambda r: -r["amount"])
    return {"total": round(sum(r["amount"] for r in rows), 2), "by_method": rows}


async def _hourly_sales(ctx: Ctx) -> dict:
    hourly = await hourly_sales(ctx.db, ctx.tenant_id, ctx.start, ctx.end)
    peak = max(range(24), key=lambda h: hourly[h]) if any(v > 0 for v in hourly) else None
    return {"hourly": hourly, "peak_hour": peak}


async def _top_items(ctx: Ctx) -> dict:
    return {"items": await top_items(ctx.db, ctx.tenant_id, ctx.start, ctx.end, limit=5)}


async def _voids_comps(ctx: Ctx) -> dict:
    """Money off the table today, with the same rules as the Owner's watch (app/api/owner.py): bills cancelled today,
    items cancelled after / removed before the kitchen, on the house, and manual discounts on bills completed today."""
    t, start, end = ctx.tenant_id, ctx.start, ctx.end
    cancelled = (await ctx.db.execute(select(func.count(Order.id), func.coalesce(func.sum(Order.total_amount), 0))
                                      .where(Order.tenant_id == t, Order.status == "cancelled", Order.updated_at >= start,
                                             Order.updated_at < end))).one()
    gone_rows = (await ctx.db.execute(
        select(OrderItem.kitchen_status, func.coalesce(func.sum(OrderItem.quantity), 0),
               func.coalesce(func.sum(OrderItem.unit_price * OrderItem.quantity), 0))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.tenant_id == t, OrderItem.kitchen_status.in_(["void", "removed"]), OrderItem.status_at >= start,
               OrderItem.status_at < end)
        .group_by(OrderItem.kitchen_status))).all()
    gone = {status: (qty, value) for status, qty, value in gone_rows}
    comps = (await ctx.db.execute(select(func.count(OrderItem.id), func.coalesce(func.sum(OrderItem.comp_value), 0))
                                  .join(Order, Order.id == OrderItem.order_id)
                                  .where(Order.tenant_id == t, OrderItem.comp_reason.isnot(None), Order.status != "cancelled",
                                         Order.created_at >= start, Order.created_at < end))).one()
    discounted = (await ctx.db.execute(
        select(func.count(Order.id), func.coalesce(func.sum(Order.discount_amount - func.coalesce(Order.offer_discount, 0)), 0))
        .where(Order.tenant_id == t, Order.status == "completed", Order.completed_at >= start, Order.completed_at < end,
               Order.discount_amount > Order.offer_discount))).one()
    void_qty, void_value = gone.get("void", (0, 0))
    removed_qty, removed_value = gone.get("removed", (0, 0))
    return {
        "cancelled_bills": int(cancelled[0]), "cancelled_bills_value": round(money(cancelled[1]), 2),
        "items_cancelled": int(void_qty), "items_cancelled_value": round(money(void_value), 2),
        "items_removed": int(removed_qty), "items_removed_value": round(money(removed_value), 2),
        "on_the_house": int(comps[0]), "on_the_house_value": round(money(comps[1]), 2),
        "discounted_bills": int(discounted[0]), "discount_value": round(money(discounted[1]), 2),
    }


def _shape_voids_comps(data: dict, access: Access) -> dict:
    if access.is_owner:
        return data
    # Managers see how many, never the amounts (and never who: names stay on the Owner's watch)
    return {k: v for k, v in data.items() if not k.endswith("_value")}


# --- Live monitor (plan feature "dashboard_live") ---------------------------------------------------------------------

def _thresholds(ctx: Ctx, kind: str) -> tuple[int, int]:
    """(amber, red) minutes from Settings (floor alert times), as on the Tables and Kitchen screens."""
    from app.api.admin import OPS_DEFAULTS
    saved = {**OPS_DEFAULTS, **(getattr(ctx.settings, "ops_thresholds", None) or {})}
    amber, red = int(saved[f"{kind}_amber_min"]), int(saved[f"{kind}_red_min"])
    if red <= amber:
        amber, red = int(OPS_DEFAULTS[f"{kind}_amber_min"]), int(OPS_DEFAULTS[f"{kind}_red_min"])
    return amber, red


def _minutes_since(dt: datetime | None, now: datetime) -> float:
    return max(0.0, (now - dt).total_seconds() / 60) if dt else 0.0


async def _floor_live(ctx: Ctx) -> dict:
    """Tables in use and how long their guests have been there (from the oldest running bill on the table)."""
    amber, red = _thresholds(ctx, "table")
    tables = (await ctx.db.execute(select(TableEntity.id, TableEntity.table_number)
                                   .where(TableEntity.tenant_id == ctx.tenant_id, TableEntity.is_active == True))).all()  # noqa: E712
    labels = dict(tables)
    since: dict = {}
    for o in await ctx.open_orders():
        if o.table_id in labels and o.status == "open" and (o.table_id not in since or o.created_at < since[o.table_id]):
            since[o.table_id] = o.created_at
    now = datetime.utcnow()
    ages = {tid: _minutes_since(at, now) for tid, at in since.items()}
    longest = max(ages, key=lambda tid: ages[tid]) if ages else None
    return {
        "total": len(labels), "occupied": len(since), "free": len(labels) - len(since),
        "warn": sum(1 for a in ages.values() if a >= amber), "late": sum(1 for a in ages.values() if a >= red),
        "amber_min": amber, "red_min": red,
        "longest": {"table_label": labels[longest], "since": _iso(since[longest])} if longest else None,
    }


async def _kitchen_delays(ctx: Ctx) -> dict:
    """Tickets still cooking (not ready, not bumped) and how many are past the amber / red minutes."""
    amber, red = _thresholds(ctx, "kitchen")
    rows = (await ctx.db.execute(
        select(KOT.kot_no, KOT.created_at, Order.table_id, Order.token_no).join(Order, Order.id == KOT.order_id)
        .where(KOT.tenant_id == ctx.tenant_id, Order.tenant_id == ctx.tenant_id, KOT.status.in_(["pending", "preparing"]),
               KOT.bumped_at.is_(None))
        .order_by(KOT.created_at))).all()
    now = datetime.utcnow()
    ages = [_minutes_since(created_at, now) for _, created_at, _, _ in rows]
    oldest = None
    if rows:
        kot_no, created_at, table_id, token_no = rows[0]
        labels = await ctx.table_labels([table_id])
        oldest = {"kot_no": kot_no, "table_label": labels.get(table_id), "token_no": token_no, "since": _iso(created_at)}
    return {"cooking": len(rows), "warn": sum(1 for a in ages if a >= amber), "late": sum(1 for a in ages if a >= red),
            "amber_min": amber, "red_min": red, "oldest": oldest}


# --- Catalog ---------------------------------------------------------------------------------------------------------

WIDGETS: dict[str, Widget] = {w.key: w for w in (
    Widget("today_sales", ("reports.view",), BASIC, _today_sales, module="reports", refresh=60, ttl=60),
    Widget("open_bills", ("orders.view_all", "orders.pay"), BASIC, _open_bills, refresh=20, ttl=10, shape=_shape_open_bills),
    Widget("payment_claims", ("orders.pay",), BASIC, _payment_claims, business_types=RESTAURANTS, refresh=20, ttl=10),
    Widget("ready_to_pay", ("orders.pay",), BASIC, _ready_to_pay, business_types=RESTAURANTS, refresh=20, ttl=10),
    Widget("ready_to_serve", ("tables.view",), BASIC, _ready_to_serve, module="tables", business_types=RESTAURANTS, refresh=15, ttl=5,
           shape=_shape_ready_to_serve),
    Widget("my_tables", ("tables.view",), BASIC, _my_tables, module="tables", business_types=RESTAURANTS, refresh=20, ttl=10, per_staff=True),
    Widget("kitchen", ("kitchen.view",), BASIC, _kitchen, module="kitchen", business_types=KITCHENS, refresh=15, ttl=5),
    Widget("low_stock", ("inventory.view",), BASIC, _low_stock, module="inventory", refresh=60, ttl=30),
    Widget("my_day", ("reports.view_own", "reports.view"), BASIC, _my_day, module="reports", refresh=60, ttl=30, per_staff=True,
           shape=_shape_my_day),
    Widget("my_collection", ("orders.pay",), BASIC, _my_collection, refresh=60, ttl=30, per_staff=True),
    Widget("payment_split", ("reports.view",), INSIGHTS, _payment_split, module="reports", refresh=60, ttl=60),
    Widget("hourly_sales", ("reports.view",), INSIGHTS, _hourly_sales, module="reports", refresh=60, ttl=60),
    Widget("top_items", ("reports.view",), INSIGHTS, _top_items, module="reports", refresh=60, ttl=60),
    Widget("voids_comps", ("reports.view",), INSIGHTS, _voids_comps, module="reports", refresh=60, ttl=60, shape=_shape_voids_comps),
    Widget("floor_live", ("tables.view",), LIVE, _floor_live, module="tables", business_types=RESTAURANTS, refresh=20, ttl=10),
    Widget("kitchen_delays", ("kitchen.view",), LIVE, _kitchen_delays, module="kitchen", business_types=KITCHENS, refresh=15, ttl=5),
)}

# Which widgets fit each job, in order. Built-in roles use their own list; custom roles get one from their permissions.
PERSONA_WIDGETS: dict[str, tuple[str, ...]] = {
    "owner": ("today_sales", "payment_split", "open_bills", "floor_live", "payment_claims", "ready_to_pay", "ready_to_serve", "kitchen",
              "kitchen_delays", "hourly_sales", "top_items", "voids_comps", "low_stock"),
    "manager": ("floor_live", "open_bills", "ready_to_serve", "kitchen_delays", "kitchen", "payment_claims", "ready_to_pay", "today_sales",
                "voids_comps", "low_stock"),
    "cashier": ("ready_to_pay", "payment_claims", "open_bills", "my_collection", "my_day"),
    "waiter": ("my_tables", "ready_to_serve", "my_day"),
    "kitchen": ("kitchen",),
    "basic": (),  # very few permissions: the app shows a welcome card and links to the screens they can open
}
SYSTEM_PERSONAS = ("owner", "manager", "cashier", "waiter", "kitchen")


def persona(access: Access) -> str:
    if access.role in SYSTEM_PERSONAS:
        return access.role
    if access.can("reports.view"):
        return "manager"
    if access.can("orders.pay"):
        return "cashier"
    if access.can("orders.create"):
        return "waiter"
    if access.can("kitchen.view"):
        return "kitchen"
    return "basic"


def _allowed_by_role(w: Widget, access: Access, business_type: str) -> bool:
    if not any(access.can(p) for p in w.permissions):
        return False
    if w.module and not access.has(w.module):
        return False
    if w.business_types and business_type not in w.business_types:
        return False
    if w.per_staff and not access.staff_id:
        return False
    return True


def select_widgets(access: Access, business_type: str, who: str | None = None) -> tuple[list[Widget], list[str]]:
    """(widgets to show in order, keys the plan lacks). Locked keys are only for the owner's "more on a higher plan" card."""
    who = who or persona(access)
    shown, locked = [], []
    for key in PERSONA_WIDGETS.get(who, ()):
        w = WIDGETS[key]
        if not _allowed_by_role(w, access, business_type):
            continue
        if w.plan_feature and not access.has(w.plan_feature):
            locked.append(w.key)
            continue
        shown.append(w)
    return shown, (locked if access.is_owner else [])


async def _run(ctx: Ctx, w: Widget) -> dict:
    scope = f":{ctx.access.staff_id}" if w.per_staff else ""
    key = f"{ctx.tenant_id}:{w.key}:{ctx.start:%Y%m%d}{scope}"
    try:
        async with ctx.db.begin_nested():  # a failing widget never spoils the others' queries
            data = await get_or_compute(key, w.ttl, lambda: w.compute(ctx))
        if w.shape:
            data = w.shape(data, ctx.access)
        return {"key": w.key, "refresh": w.refresh, "data": data}
    except Exception:
        logger.exception(f"[Dashboard] Widget {w.key} failed", extra={"tenant_id": ctx.tenant_id})
        return {"key": w.key, "refresh": w.refresh, "error": "Couldn't load this right now."}


async def build_dashboard(db: AsyncSession, access: Access, only: set[str] | None = None) -> dict:
    """Home for the signed-in person. `only`: just these widget keys (the app refreshes fast and slow widgets apart)."""
    settings = await get_settings(db, access.tenant_id)
    business_type = settings.business_type or "restaurant"
    start, end = day_range()
    ctx = Ctx(db=db, access=access, business_type=business_type, settings=settings, start=start, end=end)
    who = persona(access)
    shown, locked = select_widgets(access, business_type, who)
    widgets = [await _run(ctx, w) for w in shown if only is None or w.key in only]
    return {
        "persona": who, "business_type": business_type, "server_time": _iso(datetime.utcnow()),
        "day": {"from": _iso(start), "to": _iso(end)}, "widgets": widgets, "locked": locked,
    }
