import uuid
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.tenant import get_tenant_db
from app.services.access import Access, get_access, require
from app.models import Product, InventoryLog, TenantUser
from app.services import audit, stock_service
from app.services.settings_service import get_default_location, get_settings
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/inventory", tags=["Inventory"])

class StockAdjustment(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(ge=-1_000_000, le=1_000_000)
    reason: Literal["restock", "wastage", "adjustment", "return"]
    note: str | None = Field(None, max_length=200)
    unit_cost: float | None = Field(None, ge=0, le=1_000_000)

class ReceiveStockRequest(BaseModel):  # legacy shape
    product_id: uuid.UUID
    quantity: int = Field(gt=0, le=1_000_000)
    location_id: uuid.UUID | None = None

class StockCount(BaseModel):
    product_id: uuid.UUID
    quantity: int = Field(ge=-1_000_000, le=1_000_000)  # what is on the shelf now
    note: str | None = Field(None, max_length=200)

async def _stock_levels(db: AsyncSession, tenant_id: str) -> list[dict]:
    """Tracked items with the stock counter (the same number the POS, menus, reports and Home show). Items never
    counted have `counted: false` and stock 0; they are never low or sold out."""
    settings = await get_settings(db, tenant_id)
    query = select(Product).where(Product.tenant_id == tenant_id, Product.is_active == True, Product.track_stock == True) \
        .order_by(Product.name)  # noqa: E712
    data = []
    for product in (await db.execute(query)).scalars().all():
        counted = product.stock_on_hand is not None
        stock = int(product.stock_on_hand) if counted else 0
        threshold = product.low_stock_threshold if product.low_stock_threshold is not None else settings.low_stock_default
        data.append({
            "id": str(product.id), "name": product.name, "category_id": str(product.category_id) if product.category_id else None,
            "barcode": product.barcode, "unit": product.unit, "stock": stock, "counted": counted, "low_stock_threshold": threshold,
            "is_low": counted and stock <= threshold, "sold_out": counted and stock <= 0,
            "cost_price": float(product.cost_price) if product.cost_price is not None else None,
            "stock_value": float((product.cost_price or 0) * max(stock, 0)) if counted else 0.0,
        })
    return data

@router.get("")
async def get_inventory(response: Response, q: str | None = Query(None, max_length=60),
                        filter: str | None = Query(None, pattern="^(low|out)$"),
                        limit: int | None = Query(None, ge=1, le=1000), offset: int = Query(0, ge=0),
                        access: Access = Depends(require("inventory.view", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    """All tracked items by default; `q`, `filter=low|out` and paging for big stores. Counts in `X-Counts` (all/low/out)."""
    import json
    rows = await _stock_levels(db, access.tenant_id)
    response.headers["X-Counts"] = json.dumps({"all": len(rows), "low": sum(1 for r in rows if r["is_low"]),
                                               "out": sum(1 for r in rows if r["sold_out"])})
    if q:
        term = q.strip().lower()
        rows = [r for r in rows if term in r["name"].lower() or (r["barcode"] or "") == q.strip()]
    if filter == "low":
        rows = [r for r in rows if r["is_low"]]
    elif filter == "out":
        rows = [r for r in rows if r["sold_out"]]
    response.headers["X-Total-Count"] = str(len(rows))
    return rows[offset:offset + limit] if limit is not None else rows

@router.get("/low-stock")
async def low_stock(access: Access = Depends(require("inventory.view", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    return [row for row in await _stock_levels(db, access.tenant_id) if row["is_low"]]

@router.get("/logs")
async def stock_logs(product_id: uuid.UUID | None = None, limit: int = Query(100, ge=1, le=500),
                     access: Access = Depends(require("inventory.view", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    query = (select(InventoryLog, Product.name, TenantUser.full_name, TenantUser.username)
             .join(Product, Product.id == InventoryLog.product_id)
             .outerjoin(TenantUser, (TenantUser.id == InventoryLog.created_by) & (TenantUser.tenant_id == access.tenant_id))
             .where(InventoryLog.tenant_id == access.tenant_id))
    if product_id:
        query = query.where(InventoryLog.product_id == product_id)
    rows = (await db.execute(query.order_by(InventoryLog.created_at.desc()).limit(limit))).all()
    return [{"id": str(log.id), "product_id": str(log.product_id), "product_name": name, "quantity_change": log.quantity_change,
             "reason": log.reason, "note": log.note, "by": full_name or username,
             "created_at": log.created_at.isoformat() + "Z"} for log, name, full_name, username in rows]

@router.post("/adjust")
async def adjust_stock(data: StockAdjustment, access: Access = Depends(require("inventory.manage", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    tenant_id = access.tenant_id
    result = await db.execute(select(Product).where(Product.id == data.product_id, Product.tenant_id == tenant_id))
    product = result.scalars().first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    if data.quantity == 0:
        raise HTTPException(status_code=400, detail="Quantity cannot be zero")
    quantity = data.quantity
    if data.reason == "wastage" and quantity > 0:
        quantity = -quantity  # wastage always reduces stock
    location = await get_default_location(db, tenant_id)
    product.track_stock = True
    if data.unit_cost is not None and data.reason == "restock":
        product.cost_price = data.unit_cost
    stock = await stock_service.record_entry(db, tenant_id, product, quantity, data.reason, location_id=location.id, note=data.note,
                                             unit_cost=data.unit_cost, staff_id=access.staff_id)
    audit.record(db, access, "inventory.adjust", entity_type="product", entity_id=product.id,
                 summary=f"{data.reason.capitalize()} {quantity:+d} × {product.name} (now {stock})", details={"note": data.note})
    await db.commit()
    logger.info(f"[Inventory] {data.reason} {quantity} of {product.id}", extra={"tenant_id": tenant_id})
    return {"success": True, "stock": stock}

@router.post("/count")
async def count_stock(data: StockCount, access: Access = Depends(require("inventory.manage", feature="inventory")),
                      db: AsyncSession = Depends(get_tenant_db)):
    """Set count: the shelf has `quantity` now. The difference is written as an adjustment, and the item is counted from
    now on (a tracked item that was never counted can't be sold out before this)."""
    tenant_id = access.tenant_id
    product = (await db.execute(select(Product).where(Product.id == data.product_id, Product.tenant_id == tenant_id))).scalars().first()
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found")
    location = await get_default_location(db, tenant_id)
    product.track_stock = True
    stock = await stock_service.set_count(db, tenant_id, product, data.quantity, location_id=location.id, note=data.note,
                                          staff_id=access.staff_id)
    audit.record(db, access, "inventory.count", entity_type="product", entity_id=product.id,
                 summary=f"Counted {product.name}: {stock}", details={"note": data.note})
    await db.commit()
    logger.info(f"[Inventory] count {stock} of {product.id}", extra={"tenant_id": tenant_id})
    return {"success": True, "stock": stock}

@router.post("/receive")
async def receive_inventory(data: ReceiveStockRequest, access: Access = Depends(require("inventory.manage", feature="inventory")), db: AsyncSession = Depends(get_tenant_db)):
    return await adjust_stock(StockAdjustment(product_id=data.product_id, quantity=data.quantity, reason="restock"), access, db)
