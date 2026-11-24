"""Stock: the only code that changes it. Every change writes a ledger row (inventory_logs) and keeps the counter
(products.stock_on_hand) in step, in the same transaction; any change of the counter also bumps products.updated_at so
devices get it with /sync/pull. See docs/features/007_Inventory_Management.md ("Stock counter, sold out").

When stock moves
- A line saved on a bill (new bill, items added, repeat, QR / online / delivery order) takes its stock at once
  (`take_for_lines`) and is marked `stock_held`. Cancelled / removed lines and cancelled, rejected, archived or
  deleted bills give it back (`give_back_lines`, `give_back_order`).
- Payment cuts stock only for lines that don't hold it yet (`take_unheld_at_payment`): lines saved before this existed,
  and free offer items (they come and go while a bill is priced, so they never hold stock and never block a sale).
- Stock in / out, wastage, adjustments, opening stock and counts by hand (`record_entry`, `set_count`).

Sold out
- Only tracked items that have been counted (counter not NULL) can be sold out; a tracked item without a stock entry of
  its own always sells. Blocking needs the Inventory module and the owner's "allow selling at zero" switched off.
- The two-devices race: products are locked (SELECT … FOR UPDATE, in id order, always after the bill) before their
  counters are read, so the second sale of the last units waits for the first and then sees what is left.
- Policies: STRICT refuses (409 STOCK_SHORT) unless an owner / manager sells anyway with a reason; FORCE always sells
  and remembers what was short (delivery-app orders and offline bills: the food or money is already out).
"""
import logging
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models import InventoryLog, Order, OrderItem, Product

logger = logging.getLogger("tallyko")

STRICT, FORCE = "strict", "force"
GONE = ("void", "removed")  # cancelled / removed lines (order_service.GONE)


@dataclass
class StockCheck:
    """How a sale treats items that are short.
    STRICT: refuse with 409 STOCK_SHORT, unless `override_reason` is given by someone allowed to (inventory.manage).
    FORCE: always sell (delivery-app orders, offline bills); what was short is kept in `short` for the warning."""
    policy: str = STRICT
    can_override: bool = False
    override_reason: str | None = None
    guest: bool = False  # QR / online store: the refusal names the item but never says how many are left
    short: list = field(default_factory=list)  # [{product_id, name, requested, available}] sold anyway
    overridden: bool = False


def _uuid(value) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value)) if value else None
    except ValueError:
        return None


def short_error(short: list[dict], guest: bool = False) -> HTTPException:
    """409 STOCK_SHORT: the app shows it in the person's language from `details.items`. Guests (QR, online store) get
    the item names only, never how many are left."""
    first = short[0]
    if guest:
        names = ", ".join(s["name"] for s in short)
        return HTTPException(status_code=409, detail={
            "code": "STOCK_SHORT", "message": f"Sold out: {names}. Remove it to place your order.",
            "details": {"items": [{"product_id": s["product_id"], "name": s["name"], "sold_out": True} for s in short]}})
    message = f"{first['name']} is sold out." if first["available"] <= 0 else f"{first['name']}: only {first['available']} left."
    if len(short) > 1:
        message += f" {len(short) - 1} more item{'s' if len(short) > 2 else ''} short."
    return HTTPException(status_code=409, detail={"code": "STOCK_SHORT", "message": message, "details": {"items": short}})


async def blocking(db: AsyncSession, tenant_id: str) -> bool:
    """Are sold-out items refused here? Needs the Inventory module, and selling at zero not allowed by the owner."""
    from app.services.access import entitlements
    from app.services.settings_service import get_settings
    if "inventory" not in (await entitlements(str(tenant_id)))["features"]:
        return False
    return not (await get_settings(db, tenant_id)).allow_sell_at_zero


async def ledger_sum(db: AsyncSession, tenant_id: str, product_id) -> int:
    total = (await db.execute(select(func.coalesce(func.sum(InventoryLog.quantity_change), 0))
                              .where(InventoryLog.tenant_id == tenant_id, InventoryLog.product_id == product_id))).scalar()
    return int(total or 0)


async def _tracked(db: AsyncSession, tenant_id: str, product_ids) -> set:
    ids = {i for i in product_ids if i}
    if not ids:
        return set()
    rows = await db.execute(select(Product.id).where(Product.tenant_id == tenant_id, Product.id.in_(ids), Product.track_stock == True))  # noqa: E712
    return {pid for (pid,) in rows.all()}


async def _lock_counted(db: AsyncSession, tenant_id: str, product_ids) -> dict:
    """Lock the tracked, counted products among `product_ids` (untracked / uncounted ones never take a lock), in id order,
    and read their counters fresh. Callers lock the bill first."""
    ids = sorted({i for i in product_ids if i}, key=str)
    if not ids:
        return {}
    rows = await db.execute(
        select(Product).where(Product.tenant_id == tenant_id, Product.id.in_(ids), Product.track_stock == True,  # noqa: E712
                              Product.stock_on_hand.isnot(None))
        .order_by(Product.id).with_for_update(of=Product).execution_options(populate_existing=True))
    return {p.id: p for p in rows.scalars().all()}


async def _bump_counters(db: AsyncSession, tenant_id: str, changes: dict) -> None:
    """counter += change for each product (NULL stays NULL: a never-counted item stays uncounted), in id order.
    Also bumps updated_at so /sync/pull carries the new number."""
    now = datetime.utcnow()
    for product_id in sorted(changes, key=str):
        change = changes[product_id]
        if not change:
            continue
        await db.execute(update(Product).where(Product.id == product_id, Product.tenant_id == tenant_id)
                         .values(stock_on_hand=Product.stock_on_hand + change, updated_at=now)
                         .execution_options(synchronize_session="fetch"))


def _log(db: AsyncSession, tenant_id: str, product_id, location_id, change: int, reason: str, *, order_id=None, note=None,
         unit_cost=None, staff_id=None) -> None:
    db.add(InventoryLog(id=uuid.uuid4(), tenant_id=tenant_id, product_id=product_id, location_id=location_id, quantity_change=change,
                        reason=reason, note=note, unit_cost=unit_cost, order_id=order_id, created_by=_uuid(staff_id),
                        created_at=datetime.utcnow()))


def _bill_note(order: Order) -> str:
    return f"Bill {order.invoice_no or order.code}"


async def take_for_lines(db: AsyncSession, tenant_id: str, order: Order, rows: list[OrderItem], check: StockCheck | None = None,
                         staff_id=None) -> None:
    """Take stock for lines just saved on `order` (the bill is already locked or new). Raises STOCK_SHORT (strict)."""
    check = check or StockCheck()
    rows = [r for r in rows if r.kitchen_status not in GONE and not r.stock_held and (r.quantity or 0) > 0]
    tracked = await _tracked(db, tenant_id, {r.product_id for r in rows})
    rows = [r for r in rows if r.product_id in tracked]
    if not rows:
        return
    wanted: dict = defaultdict(int)
    for r in rows:
        wanted[r.product_id] += r.quantity
    counted = await _lock_counted(db, tenant_id, wanted.keys())
    short = [{"product_id": str(p.id), "name": p.name, "requested": wanted[p.id], "available": max(int(p.stock_on_hand), 0)}
             for p in sorted(counted.values(), key=lambda p: str(p.id)) if wanted[p.id] > int(p.stock_on_hand)]
    if short and await blocking(db, tenant_id):
        if check.policy == FORCE:
            check.short.extend(short)
        elif check.can_override and (check.override_reason or "").strip():
            check.overridden = True
            check.short.extend(short)
        else:
            raise short_error(short, guest=check.guest)
    changes: dict = defaultdict(int)
    for r in rows:
        _log(db, tenant_id, r.product_id, order.location_id, -r.quantity, "sale", order_id=order.id, note=_bill_note(order), staff_id=staff_id)
        changes[r.product_id] -= r.quantity
        r.stock_held = True
    await _bump_counters(db, tenant_id, changes)


async def take_unheld_at_payment(db: AsyncSession, tenant_id: str, order: Order, staff_id=None) -> None:
    """Payment: tracked lines that don't hold stock yet cut it now (never refused: the bill is being paid)."""
    await take_for_lines(db, tenant_id, order, [r for r in order.items if not r.stock_held], StockCheck(policy=FORCE), staff_id)


async def give_back_lines(db: AsyncSession, tenant_id: str, order: Order, rows: list[OrderItem], reason: str = "void",
                          staff_id=None, note: str | None = None) -> None:
    """Lines that hold stock give it back (a line cancelled or removed from a bill)."""
    rows = [r for r in rows if r.stock_held and (r.quantity or 0) > 0]
    if not rows:
        return
    changes: dict = defaultdict(int)
    for r in rows:
        _log(db, tenant_id, r.product_id, order.location_id, r.quantity, reason, order_id=order.id,
             note=note or f"Back from {_bill_note(order)}", staff_id=staff_id)
        changes[r.product_id] += r.quantity
        r.stock_held = False
    await _bump_counters(db, tenant_id, changes)


async def give_back_order(db: AsyncSession, tenant_id: str, order: Order, staff_id=None) -> None:
    """A bill cancelled, rejected, archived or deleted: everything it holds comes back. A bill paid before lines held
    stock (`stock_deducted`, no held line) gives back what payment cut, as it always did."""
    held = [r for r in order.items if r.stock_held]
    if held:
        await give_back_lines(db, tenant_id, order, held, reason="return", staff_id=staff_id, note=f"Cancelled {_bill_note(order)}")
    elif order.stock_deducted:
        lines = [r for r in order.items if r.kitchen_status not in GONE]
        tracked = await _tracked(db, tenant_id, {r.product_id for r in lines})
        changes: dict = defaultdict(int)
        for r in lines:
            if r.product_id in tracked:
                _log(db, tenant_id, r.product_id, order.location_id, r.quantity, "return", order_id=order.id,
                     note=f"Cancelled {_bill_note(order)}", staff_id=staff_id)
                changes[r.product_id] += r.quantity
        await _bump_counters(db, tenant_id, changes)
    order.stock_deducted = False


async def waste_lines(db: AsyncSession, tenant_id: str, order: Order, rows: list[OrderItem], note: str, staff_id=None) -> None:
    """Food cancelled after the kitchen made it and thrown away: wastage for tracked items (after the line gave its
    held stock back, so the net change is the wastage only)."""
    tracked = await _tracked(db, tenant_id, {r.product_id for r in rows})
    changes: dict = defaultdict(int)
    for r in rows:
        if r.product_id in tracked and (r.quantity or 0) > 0:
            _log(db, tenant_id, r.product_id, order.location_id, -r.quantity, "wastage", order_id=order.id, note=note, staff_id=staff_id)
            changes[r.product_id] -= r.quantity
    await _bump_counters(db, tenant_id, changes)


async def record_entry(db: AsyncSession, tenant_id: str, product: Product, change: int, reason: str, *, location_id,
                       note: str | None = None, unit_cost=None, staff_id=None) -> int | None:
    """Stock in / out, wastage, adjustment or opening stock entered by hand. The first such entry starts the counter
    (at the ledger sum, which includes earlier sales). Returns the new counter."""
    locked = (await _lock_counted(db, tenant_id, [product.id])).get(product.id)
    _log(db, tenant_id, product.id, location_id, change, reason, note=note, unit_cost=unit_cost, staff_id=staff_id)
    now = datetime.utcnow()
    if locked is not None:
        await _bump_counters(db, tenant_id, {product.id: change})
    else:
        await db.flush()
        total = await ledger_sum(db, tenant_id, product.id)
        await db.execute(update(Product).where(Product.id == product.id, Product.tenant_id == tenant_id)
                         .values(stock_on_hand=total, updated_at=now).execution_options(synchronize_session="fetch"))
    await db.flush()
    return (await db.execute(select(Product.stock_on_hand).where(Product.id == product.id, Product.tenant_id == tenant_id))).scalar()


async def set_count(db: AsyncSession, tenant_id: str, product: Product, counted: int, *, location_id, note: str | None = None,
                    staff_id=None) -> int:
    """"Set count": the shelf has `counted`. Writes the difference as an adjustment and sets the counter to it."""
    locked = (await _lock_counted(db, tenant_id, [product.id])).get(product.id)
    current = int(locked.stock_on_hand) if locked is not None else await ledger_sum(db, tenant_id, product.id)
    _log(db, tenant_id, product.id, location_id, counted - current, "adjustment",
         note=(note or "").strip()[:200] or f"Counted {counted}", staff_id=staff_id)
    await db.execute(update(Product).where(Product.id == product.id, Product.tenant_id == tenant_id)
                     .values(stock_on_hand=counted, updated_at=datetime.utcnow()).execution_options(synchronize_session="fetch"))
    await db.flush()
    return counted


async def recount(db: AsyncSession, tenant_id: str, product_ids) -> None:
    """Counter = ledger sum again for counted products (after the super admin deleted a bill's ledger rows)."""
    for product_id in sorted({p for p in product_ids if p}, key=str):
        await db.execute(update(Product).where(Product.id == product_id, Product.tenant_id == tenant_id, Product.stock_on_hand.isnot(None))
                         .values(stock_on_hand=await ledger_sum(db, tenant_id, product_id), updated_at=datetime.utcnow())
                         .execution_options(synchronize_session="fetch"))


async def check_counters(db: AsyncSession, fix: bool = False) -> list[dict]:
    """Counted products whose counter differs from the ledger sum (manage.py stock:check). `fix` sets them right.
    Run with a system session (all businesses)."""
    sums = select(InventoryLog.tenant_id, InventoryLog.product_id, func.sum(InventoryLog.quantity_change).label("total")) \
        .group_by(InventoryLog.tenant_id, InventoryLog.product_id).subquery()
    rows = (await db.execute(
        select(Product.tenant_id, Product.id, Product.name, Product.stock_on_hand, func.coalesce(sums.c.total, 0))
        .outerjoin(sums, (sums.c.product_id == Product.id) & (sums.c.tenant_id == Product.tenant_id))
        .where(Product.stock_on_hand.isnot(None)))).all()
    wrong = [{"tenant_id": str(t), "product_id": str(pid), "name": name, "counter": int(counter), "ledger": int(total)}
             for t, pid, name, counter, total in rows if int(counter) != int(total)]
    if fix:
        for row in wrong:
            await db.execute(update(Product).where(Product.id == uuid.UUID(row["product_id"]))
                             .values(stock_on_hand=row["ledger"], updated_at=datetime.utcnow()))
        await db.commit()
    return wrong


def sold_out(product: Product) -> bool:
    """Counted and at or below zero (whether that blocks a sale depends on `blocking`)."""
    return bool(product.track_stock) and product.stock_on_hand is not None and int(product.stock_on_hand) <= 0
