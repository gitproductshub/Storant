import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.future import select
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.models import KOT, TableEntity, Order, OrderItem, TenantUser
from app.services.settings_service import get_default_location
from app.services.order_service import OPEN_STATUSES
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/tables", tags=["Tables"])

class TableIn(BaseModel):
    table_number: str = Field(min_length=1, max_length=20)
    section: str | None = Field(None, max_length=40)
    capacity: int = Field(4, ge=1, le=100)
    assigned_staff_id: uuid.UUID | None = None  # waiter who looks after this table

class TableUpdate(BaseModel):
    table_number: str | None = Field(None, min_length=1, max_length=20)
    section: str | None = Field(None, max_length=40)
    capacity: int | None = Field(None, ge=1, le=100)
    is_active: bool | None = None
    assigned_staff_id: uuid.UUID | None = None  # null clears the assignment

async def _check_staff(db, tenant_id: str, staff_id) -> None:
    if staff_id and not (await db.execute(select(TenantUser.id).where(TenantUser.id == staff_id, TenantUser.tenant_id == tenant_id,
                                                                     TenantUser.is_active == True))).first():
        raise HTTPException(status_code=404, detail="Staff member not found")

def _bill(o: Order, counts: dict, names: dict | None = None) -> dict:
    return {"id": str(o.id), "code": o.code, "bill_label": o.bill_label, "total_amount": float(o.total_amount),
            "status": o.status, "payment_status": o.payment_status, "guests": o.guests, "customer_name": o.customer_name,
            "waiter_id": str(o.waiter_id) if o.waiter_id else None, "waiter_name": (names or {}).get(o.waiter_id),
            "created_at": o.created_at.isoformat() + "Z",
            "kitchen": counts.get(o.id, {}), "payment_claim": o.payment_claim}  # {"pending": 2, "ready": 1, …} live lines per kitchen status

def _serialize(t: TableEntity, order: Order | None, bills: list | None = None, names: dict | None = None) -> dict:
    running = order if order and order.status in OPEN_STATUSES else None
    return {
        "open_bills": bills or [],
        "id": str(t.id), "table_number": t.table_number, "section": t.section, "capacity": t.capacity,
        "is_active": t.is_active, "status": "occupied" if running else "free",
        "assigned_staff_id": str(t.assigned_staff_id) if t.assigned_staff_id else None,
        "assigned_staff_name": (names or {}).get(t.assigned_staff_id),
        "current_order": {
            "id": str(running.id), "code": running.code, "total_amount": float(running.total_amount),
            "status": running.status, "created_at": running.created_at.isoformat() + "Z",
            "customer_name": running.customer_name,
        } if running else None,
    }

@router.get("")
async def get_tables(access: Access = Depends(require("tables.view", feature="tables")), db=Depends(get_tenant_db)):
    result = await db.execute(select(TableEntity).where(TableEntity.tenant_id == access.tenant_id, TableEntity.is_active == True)
                              .order_by(TableEntity.section, TableEntity.table_number))
    tables = result.scalars().all()
    open_orders = (await db.execute(select(Order).where(Order.tenant_id == access.tenant_id, Order.table_id.isnot(None),
                                                        Order.status.in_(OPEN_STATUSES)).order_by(Order.created_at))).scalars().all()
    counts: dict = {}
    if open_orders:
        rows = await db.execute(select(OrderItem.order_id, OrderItem.kitchen_status, func.count())
                                .where(OrderItem.order_id.in_([o.id for o in open_orders]), OrderItem.kitchen_status.isnot(None),
                                       OrderItem.kitchen_status != "void")
                                .group_by(OrderItem.order_id, OrderItem.kitchen_status))
        for oid, status, n in rows.all():
            counts.setdefault(oid, {})[status] = int(n)
    waiter_ids = {o.waiter_id for o in open_orders if o.waiter_id} | {t.assigned_staff_id for t in tables if t.assigned_staff_id}
    names = {uid: (name or email) for uid, name, email in (await db.execute(
        select(TenantUser.id, TenantUser.full_name, TenantUser.username).where(TenantUser.id.in_(waiter_ids),
                                                                              TenantUser.tenant_id == access.tenant_id))).all()} if waiter_ids else {}
    by_table: dict = {}
    for o in open_orders:
        by_table.setdefault(o.table_id, []).append(o)
    return sorted((_serialize(t, (by_table.get(t.id) or [None])[0], [_bill(o, counts, names) for o in by_table.get(t.id, [])], names) for t in tables),
                  key=lambda t: (t["section"] or "", _natural(t["table_number"])))

@router.get("/ready-to-serve")
async def ready_to_serve(access: Access = Depends(require("tables.view", feature="tables")), db=Depends(get_tenant_db)):
    """Dine-in food waiting to be served, for the floor staff's voice alerts ("टेबल 5 का ऑर्डर तैयार है") and reminders.

    One entry per kitchen ticket on a running dine-in table bill (a ticket split across two bills gives one entry per bill)
    once **every live item of it is ready** and at least one is not served yet. Served, cancelled (void) and removed items
    don't count; takeaway / delivery / online orders never appear (nobody serves them at a table). `ready_since` is when
    its last item became ready; `server_time` lets devices with a wrong clock time their reminders.
    """
    tenant_id = access.tenant_id
    rows = (await db.execute(
        select(OrderItem.kot_id, OrderItem.order_id, OrderItem.kitchen_status, OrderItem.quantity, OrderItem.status_at)
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.tenant_id == tenant_id, Order.type == "DINE_IN", Order.table_id.isnot(None), Order.status.in_(OPEN_STATUSES),
               OrderItem.kot_id.isnot(None), OrderItem.kitchen_status.notin_(["void", "removed"]))
    )).all()
    groups: dict = {}
    for kot_id, order_id, status, quantity, status_at in rows:
        g = groups.setdefault((kot_id, order_id), {"statuses": set(), "ready": 0, "since": None})
        g["statuses"].add(status or "pending")
        if status == "ready":
            g["ready"] += quantity
            if status_at and (g["since"] is None or status_at > g["since"]):
                g["since"] = status_at
    waiting = {k: g for k, g in groups.items() if g["ready"] > 0 and g["statuses"] <= {"ready", "served"}}
    result = {"server_time": datetime.utcnow().isoformat() + "Z", "items": []}
    if not waiting:
        return result
    orders = {o.id: o for o in (await db.execute(select(Order).where(Order.tenant_id == tenant_id,
                                                                     Order.id.in_(list({oid for _, oid in waiting}))))).scalars().all()}
    tables = {t.id: t for t in (await db.execute(select(TableEntity).where(TableEntity.tenant_id == tenant_id,
                                                                           TableEntity.id.in_(list({o.table_id for o in orders.values()}))))).scalars().all()}
    kot_nos = dict((await db.execute(select(KOT.id, KOT.kot_no).where(KOT.tenant_id == tenant_id, KOT.id.in_(list({k for k, _ in waiting}))))).all())
    items = []
    for (kot_id, order_id), g in waiting.items():
        order = orders.get(order_id)
        table = tables.get(order.table_id) if order else None
        if not order or not table:
            continue
        items.append({
            "kot_id": str(kot_id), "kot_no": kot_nos.get(kot_id), "order_id": str(order_id), "order_code": order.code,
            "table_id": str(table.id), "table_label": table.table_number, "bill_label": order.bill_label,
            "assigned_staff_id": str(table.assigned_staff_id) if table.assigned_staff_id else None,
            "waiter_id": str(order.waiter_id) if order.waiter_id else None,
            "ready_count": g["ready"], "ready_since": g["since"].isoformat() + "Z" if g["since"] else None,
        })
    result["items"] = sorted(items, key=lambda i: (i["ready_since"] or "", _natural(i["table_label"])))
    return result

def _natural(label: str):
    digits = "".join(c for c in label if c.isdigit())
    return (int(digits) if digits else 10**9, label)

@router.post("")
async def create_table(data: TableIn, access: Access = Depends(require("tables.manage", feature="tables")), db=Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    dup = await db.execute(select(TableEntity.id).where(TableEntity.tenant_id == tenant_id, TableEntity.is_active == True,
                                                        TableEntity.table_number == data.table_number.strip()))
    if dup.first():
        raise HTTPException(status_code=409, detail=f"Table {data.table_number} already exists")
    await _check_staff(db, tenant_id, data.assigned_staff_id)
    location = await get_default_location(db, tenant_id)
    table = TableEntity(id=uuid.uuid4(), tenant_id=tenant_id, location_id=location.id, table_number=data.table_number.strip(),
                        section=(data.section or "").strip() or None, capacity=data.capacity,
                        assigned_staff_id=data.assigned_staff_id)
    db.add(table)
    await db.commit()
    return _serialize(table, None)

@router.put("/{table_id}")
async def update_table(table_id: uuid.UUID, data: TableUpdate, access: Access = Depends(require("tables.manage", feature="tables")), db=Depends(get_tenant_db)):
    result = await db.execute(select(TableEntity).where(TableEntity.id == table_id, TableEntity.tenant_id == access.tenant_id))
    table = result.scalars().first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    update = data.model_dump(exclude_unset=True)
    await _check_staff(db, access.tenant_id, update.get("assigned_staff_id"))
    if update.get("is_active") is False and table.current_order_id:
        order = await db.get(Order, table.current_order_id)
        if order and order.status in OPEN_STATUSES:
            raise HTTPException(status_code=409, detail="Close the running order before removing this table")
    for key, value in update.items():
        setattr(table, key, value)
    await db.commit()
    return _serialize(table, None)

@router.delete("/{table_id}")
async def delete_table(table_id: uuid.UUID, access: Access = Depends(require("tables.manage", feature="tables")), db=Depends(get_tenant_db)):
    return await update_table(table_id, TableUpdate(is_active=False), access, db)
