"""Inbound order webhook for aggregators (Swiggy, Zomato, ONDC, magicpin) or any middleware.

Swiggy/Zomato only push orders to approved POS partners, so live integration needs their partner
onboarding. Until then orders are punched in manually from the aggregator tablet, or a connector
(self-hosted bridge, ONDC seller app, etc.) can POST here with an HMAC signature.

POST /api/v1/integrations/{channel}/orders/{tenant_id}
Header X-Storant-Signature: hex(HMAC-SHA256(channel webhook_secret, raw request body))
(the older X-Tallyko-Signature header is still accepted)
"""
import hashlib
import hmac
import json
import uuid
from typing import List
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, or_
from sqlalchemy.future import select
from app.core.rate_limit import rate_limit
from app.core.tenant import open_tenant_session
from app.models import Product
from app.schemas.billing import OrderCreate, OrderItemIn, PaymentIn, PHONE_PATTERN
from app.services import audit, order_service
from app.services.settings_service import get_channel, AGGREGATOR_CHANNELS
from app.services.stock_service import FORCE, StockCheck
import logging

logger = logging.getLogger("tallyko")
router = APIRouter(prefix="/integrations", tags=["Integrations"])

class WebhookItem(BaseModel):
    product_id: uuid.UUID | None = None
    sku: str | None = Field(None, max_length=48)
    name: str | None = Field(None, max_length=120)
    quantity: int = Field(ge=1, le=999)
    notes: str | None = Field(None, max_length=200)

class WebhookOrder(BaseModel):
    external_order_id: str = Field(min_length=1, max_length=64)
    order_type: str = "DELIVERY"
    customer_name: str | None = Field(None, max_length=100)
    customer_phone: str | None = Field(None, pattern=PHONE_PATTERN)
    delivery_address: str | None = Field(None, max_length=500)
    notes: str | None = Field(None, max_length=500)
    prepaid: bool = True
    items: List[WebhookItem] = Field(min_length=1, max_length=100)

@router.post("/{channel}/orders/{tenant_id}")
async def receive_order(channel: str, tenant_id: uuid.UUID, request: Request):
    await rate_limit(request, requests=120, window=60, key=f"webhook:{tenant_id}")
    code = channel.upper()
    if code not in AGGREGATOR_CHANNELS:
        raise HTTPException(status_code=404, detail="Unknown channel")
    body = await request.body()
    if len(body) > 256 * 1024:
        raise HTTPException(status_code=413, detail="Payload too large")

    async for db in open_tenant_session(str(tenant_id)):
        sales_channel = await get_channel(db, str(tenant_id), code)
        # X-Tallyko-Signature is the pre-rename header; connectors already using it keep working.
        signature = request.headers.get("X-Storant-Signature") or request.headers.get("X-Tallyko-Signature", "")
        expected = hmac.new((sales_channel.webhook_secret or "").encode(), body, hashlib.sha256).hexdigest() if sales_channel else ""
        if not sales_channel or not sales_channel.webhook_secret or not hmac.compare_digest(signature, expected):
            logger.warning(f"[Integrations] Bad signature for {code}", extra={"tenant_id": str(tenant_id)})
            raise HTTPException(status_code=401, detail="Invalid signature")
        if not sales_channel.enabled:
            raise HTTPException(status_code=403, detail=f"{sales_channel.name} is turned off for this business")
        try:
            payload = WebhookOrder.model_validate(json.loads(body))
        except (ValueError, ValidationError) as exc:
            raise HTTPException(status_code=422, detail=f"Invalid order payload: {exc}")

        items, unmatched = [], []
        for item in payload.items:
            query = select(Product.id).where(Product.tenant_id == tenant_id, Product.is_active == True)
            if item.product_id:
                query = query.where(Product.id == item.product_id)
            elif item.sku:
                query = query.where(or_(Product.sku == item.sku, Product.barcode == item.sku))
            elif item.name:
                query = query.where(func.lower(Product.name) == item.name.strip().lower())
            else:
                unmatched.append("(no identifier)")
                continue
            product_id = (await db.execute(query)).scalar()
            if product_id is None:
                unmatched.append(item.name or item.sku or str(item.product_id))
            else:
                items.append(OrderItemIn(product_id=product_id, quantity=item.quantity, notes=item.notes))
        if unmatched:
            raise HTTPException(status_code=422, detail={"message": "Items not found in menu", "items": unmatched})

        order_type = payload.order_type if payload.order_type in ("DELIVERY", "TAKEAWAY") else "DELIVERY"
        order_in = OrderCreate(channel=code, order_type=order_type, external_order_id=payload.external_order_id,
                               customer_name=payload.customer_name, customer_phone=payload.customer_phone,
                               delivery_address=payload.delivery_address, notes=payload.notes, items=items)
        # Never refuse a paid delivery-app order for stock: accept it, take the stock (it may go below zero), warn staff
        stock = StockCheck(policy=FORCE)
        order, created = await order_service.create_order(db, str(tenant_id), order_in, public=True, stock=stock)
        if created and stock.short:
            items = ", ".join(f"{s['requested']} × {s['name']} ({s['available']} left)" for s in stock.short)
            audit.record_system(db, str(tenant_id), "stock.short", actor_name=sales_channel.name, entity_type="order", entity_id=order.id,
                                summary=f"{sales_channel.name} order {payload.external_order_id} accepted short on stock: {items}",
                                details={"items": stock.short, "channel": code})
            logger.warning(f"[Integrations] {code} order {payload.external_order_id} short on stock: {items}",
                           extra={"tenant_id": str(tenant_id)})
        if created and payload.prepaid:
            order.payment_status = "paid"
            db.add(order_service.Payment(id=uuid.uuid4(), order_id=order.id, method="AGGREGATOR", amount=order.total_amount,
                                         reference=payload.external_order_id))
            if order.status == "open":
                await order_service._finalize(db, str(tenant_id), order, await order_service.get_settings(db, str(tenant_id)))
        await db.commit()
        logger.info(f"[Integrations] {code} order {payload.external_order_id} -> {order.code}", extra={"tenant_id": str(tenant_id)})
        return {"id": str(order.id), "code": order.code, "status": order.status, "created": created}
