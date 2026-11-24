"""Stock counter and sold-out items (app/services/stock_service.py): stock is taken when a line is saved on a bill,
given back on every cancel path, blocked per channel, and never deducted twice."""
import asyncio
import hashlib
import hmac
import json
import uuid
import pytest
import pytest_asyncio
from sqlalchemy import delete, update
from tests.conftest import create_product, create_staff, random_client_ip
from app.core.security import get_password_hash
from app.core.tenant import get_shared_session_maker
from app.models import GlobalUser, OrderItem


async def _stock(client, headers, product_id) -> dict:
    rows = (await client.get("/api/v1/inventory", headers=headers)).json()
    return next(r for r in rows if r["id"] == product_id)


async def _count(client, headers, product_id, quantity):
    resp = await client.post("/api/v1/inventory/count", headers=headers, json={"product_id": product_id, "quantity": quantity})
    assert resp.status_code == 200, resp.text
    return resp.json()["stock"]


async def _tracked(client, headers, name, count, price=50, **extra):
    product = await create_product(client, headers, name, price, tax_rate=0, track_stock=True, **extra)
    await _count(client, headers, product["id"], count)
    return product


async def _order(client, headers, product, quantity, **extra):
    return await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": product["id"], "quantity": quantity}], **extra})


def _code(resp) -> str | None:
    body = resp.json()
    return (body.get("error") or {}).get("code") if isinstance(body, dict) else None


@pytest.mark.asyncio
async def test_counter_follows_every_stock_change(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    p = await create_product(client, owner, "Buttermilk", 30, tax_rate=0, opening_stock=10)
    row = await _stock(client, owner, p["id"])
    assert row["counted"] is True and row["stock"] == 10 and row["stock_value"] >= 0
    assert (await client.post("/api/v1/inventory/adjust", headers=owner,
                              json={"product_id": p["id"], "quantity": 5, "reason": "restock"})).json()["stock"] == 15
    assert (await client.post("/api/v1/inventory/adjust", headers=owner,
                              json={"product_id": p["id"], "quantity": 2, "reason": "wastage"})).json()["stock"] == 13
    assert await _count(client, owner, p["id"], 20) == 20
    product = (await client.get(f"/api/v1/catalog/products/{p['id']}", headers=owner)).json()
    assert product["stock"] == 20 and product["sold_out"] is False
    logs = (await client.get("/api/v1/inventory/logs", headers=owner, params={"product_id": p["id"]})).json()
    assert sum(log["quantity_change"] for log in logs) == 20  # the ledger and the counter agree
    assert any(log["reason"] == "adjustment" and log["by"] for log in logs)  # who changed it

    from app.services.stock_service import check_counters
    async with get_shared_session_maker()() as db:
        assert p["id"] not in {w["product_id"] for w in await check_counters(db)}


@pytest.mark.asyncio
async def test_ten_in_stock_sell_eight_shows_two_left_everywhere(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    p = await _tracked(client, owner, "Chaas", 10)
    resp = await _order(client, owner, p, 8, payments=[{"method": "CASH", "amount": 400}])
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == 2
    assert (await client.get(f"/api/v1/catalog/products/{p['id']}", headers=owner)).json()["stock"] == 2
    live = (await client.get("/api/v1/catalog/stock", headers=owner)).json()
    assert next(i for i in live["items"] if i["id"] == p["id"]) == {"id": p["id"], "stock": 2, "sold_out": False}
    pulled = (await client.post("/api/v1/sync/pull", json={}, headers=owner)).json()
    assert next(x for x in pulled["products"] if x["id"] == p["id"])["stock"] == 2


@pytest.mark.asyncio
async def test_line_holds_stock_until_paid_and_gives_it_back(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    p = await _tracked(client, owner, "Lassi glass", 5, print_to_kitchen=True)  # sent to the kitchen: cancelling needs a reason
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "S1"})).json()
    order = (await _order(client, owner, p, 3, order_type="DINE_IN", table_id=table["id"])).json()
    assert (await _stock(client, owner, p["id"]))["stock"] == 2  # held while the bill is open, not paid yet

    line = next(i for i in order["items"] if i["product_id"] == p["id"])
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=owner,
                             json={"items": [{"item_id": line["id"], "quantity": 1}], "reason": "Changed mind"})
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == 3  # the cancelled one is back

    resp = await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=owner,
                             json={"items": [{"item_id": line["id"], "quantity": 1}], "reason": "Spilled", "waste": True})
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == 3  # back, then booked as wastage: net the same

    await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=owner, json={"reason": "Guest left"})
    assert (await _stock(client, owner, p["id"]))["stock"] == 4  # the last held one is back; the wasted one stays gone


@pytest.mark.asyncio
async def test_two_waiters_race_for_the_last_two(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    w1 = await create_staff(client, owner, "waiter")
    w2 = await create_staff(client, owner, "waiter")
    p = await _tracked(client, owner, "Buttermilk", 2)
    t1 = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "R1"})).json()
    t2 = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "R2"})).json()
    a, b = await asyncio.gather(_order(client, w1["headers"], p, 2, order_type="DINE_IN", table_id=t1["id"]),
                                _order(client, w2["headers"], p, 2, order_type="DINE_IN", table_id=t2["id"]))
    statuses = sorted([a.status_code, b.status_code])
    assert statuses == [200, 409], (a.text, b.text)
    loser = a if a.status_code == 409 else b
    assert _code(loser) == "STOCK_SHORT"
    assert loser.json()["error"]["details"]["items"][0]["available"] == 0
    assert (await _stock(client, owner, p["id"]))["stock"] == 0


@pytest.mark.asyncio
async def test_sold_out_on_every_channel(client, fresh_tenant):
    owner, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    p = await create_product(client, owner, "Masala Chai", 20, tax_rate=0, track_stock=True, sku="MC-1")
    await _count(client, owner, p["id"], 0)

    # POS: new bill and add items are refused
    resp = await _order(client, owner, p, 1)
    assert resp.status_code == 409 and _code(resp) == "STOCK_SHORT"
    assert "sold out" in resp.json()["error"]["message"]
    other = await create_product(client, owner, "Water", 10, tax_rate=0)
    bill = (await _order(client, owner, other, 1)).json()
    resp = await client.post(f"/api/v1/orders/{bill['id']}/items", headers=owner, json={"items": [{"product_id": p["id"], "quantity": 1}]})
    assert resp.status_code == 409 and _code(resp) == "STOCK_SHORT"

    # QR table and own online store: refused, and guests never see how many are left
    await client.put("/api/v1/settings", headers=owner, json={"qr_ordering_enabled": True, "store_enabled": True})
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "Q9"})).json()
    menu = (await client.get(f"/api/v1/public/{tenant_id}/menu", params={"channel": "QR"})).json()
    item = next(x for x in menu["products"] if x["id"] == p["id"])
    assert item["sold_out"] is True and "stock" not in item
    qr = {"source": "QR", "table_id": table["id"], "customer_name": "Guest", "customer_phone": "9988776600",
          "items": [{"product_id": p["id"], "quantity": 1}]}
    resp = await client.post(f"/api/v1/public/{tenant_id}/orders", json=qr)
    assert resp.status_code == 409 and _code(resp) == "STOCK_SHORT"
    assert "available" not in json.dumps(resp.json()["error"]["details"])
    online = {"source": "ONLINE", "order_type": "DELIVERY", "delivery_address": "1 MG Road", "customer_name": "A",
              "customer_phone": "9000011122", "items": [{"product_id": p["id"], "quantity": 1}]}
    resp = await client.post(f"/api/v1/public/{tenant_id}/orders", json=online)
    assert resp.status_code == 409 and _code(resp) == "STOCK_SHORT"

    # Delivery app: accepted anyway, stock goes below zero, the owner is warned
    channel = (await client.put("/api/v1/channels/ZOMATO", headers=owner, json={"enabled": True})).json()
    body = json.dumps({"external_order_id": "ZO-SHORT-1", "customer_name": "Neha", "items": [{"sku": "MC-1", "quantity": 2}]}).encode()
    sig = hmac.new(channel["webhook_secret"].encode(), body, hashlib.sha256).hexdigest()
    resp = await client.post(f"/api/v1/integrations/zomato/orders/{tenant_id}", content=body,
                             headers={"X-Storant-Signature": sig, "Content-Type": "application/json"})
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == -2
    audit = (await client.get("/api/v1/audit", headers=owner)).json()
    entries = audit["items"] if isinstance(audit, dict) else audit
    assert any(a["action"] == "stock.short" for a in entries)
    home = (await client.get("/api/v1/dashboard", headers=owner, params={"widgets": "low_stock"})).json()
    low = next(w for w in home["widgets"] if w["key"] == "low_stock")["data"]
    assert low["short_orders"] >= 1 and low["out"] >= 1

    # Offline bill: always syncs
    offline = {"id": str(uuid.uuid4()), "items": [{"product_id": p["id"], "quantity": 1}], "payments": [{"method": "CASH", "amount": 20}]}
    result = (await client.post("/api/v1/sync/push", json={"orders": [offline]}, headers=owner)).json()["results"][0]
    assert result["status"] == "ok", result
    assert (await _stock(client, owner, p["id"]))["stock"] == -3


@pytest.mark.asyncio
async def test_only_owner_or_manager_sells_anyway_with_a_reason(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    manager = await create_staff(client, owner, "manager")
    waiter = await create_staff(client, owner, "waiter")
    p = await _tracked(client, owner, "Paneer roll", 1)
    resp = await _order(client, waiter["headers"], p, 2, stock_override_reason="Guest insists")
    assert resp.status_code == 409  # a waiter can't override
    resp = await _order(client, manager["headers"], p, 2)
    assert resp.status_code == 409 and resp.json()["error"]["details"]["items"][0] == {
        "product_id": p["id"], "name": "Paneer roll", "requested": 2, "available": 1}
    resp = await _order(client, manager["headers"], p, 2, stock_override_reason="One more in the fridge")
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == -1
    watch = (await client.get("/api/v1/owner/watch", headers=owner)).json()
    assert any(e["action"] == "stock.override" for e in watch["events"])


@pytest.mark.asyncio
async def test_untracked_uncounted_and_settings_never_block(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    plain = await create_product(client, owner, "Tea", 10, tax_rate=0)
    assert (await _order(client, owner, plain, 50)).status_code == 200  # untracked: always sells
    tracked = await create_product(client, owner, "Samosa", 15, tax_rate=0, track_stock=True)
    assert (await _order(client, owner, tracked, 5)).status_code == 200  # tracked, never counted: sells
    row = await _stock(client, owner, tracked["id"])
    assert row["counted"] is False and row["is_low"] is False and row["sold_out"] is False

    p = await _tracked(client, owner, "Kulfi", 0)
    assert (await _order(client, owner, p, 1)).status_code == 409
    await client.put("/api/v1/settings", headers=owner, json={"allow_sell_at_zero": True})
    assert (await _order(client, owner, p, 1)).status_code == 200  # the owner allowed selling at zero
    await client.put("/api/v1/settings", headers=owner, json={"allow_sell_at_zero": False})
    assert (await _order(client, owner, p, 1)).status_code == 409
    await client.put("/api/v1/modules", headers=owner, json={"hidden": ["inventory"]})
    from app.services.access import invalidate
    invalidate(fresh_tenant["tenant_id"])
    assert (await _order(client, owner, p, 1)).status_code == 200  # Inventory module off: no blocking
    await client.put("/api/v1/modules", headers=owner, json={"hidden": []})


@pytest.mark.asyncio
async def test_bill_open_before_the_change_cuts_stock_once_at_payment(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    p = await _tracked(client, owner, "Jalebi", 10)
    order = (await _order(client, owner, p, 3)).json()
    assert (await _stock(client, owner, p["id"]))["stock"] == 7
    # Make it look like a line saved before stock was taken on save: not held, stock not taken
    async with get_shared_session_maker()() as db:
        await db.execute(update(OrderItem).where(OrderItem.order_id == uuid.UUID(order["id"])).values(stock_held=False))
        await db.commit()
    await _count(client, owner, p["id"], 10)
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 150}]})
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == 7  # cut at payment, exactly once
    await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=owner, json={"reason": "Refund"})
    assert (await _stock(client, owner, p["id"]))["stock"] == 10


@pytest.mark.asyncio
async def test_every_cancel_path_gives_stock_back(client, fresh_tenant):
    owner, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    p = await create_product(client, owner, "Biryani", 200, tax_rate=0, track_stock=True, sku="BR-1", print_to_kitchen=True)
    await _count(client, owner, p["id"], 10)

    # Delivery-app order rejected
    channel = (await client.put("/api/v1/channels/SWIGGY", headers=owner, json={"enabled": True})).json()
    body = json.dumps({"external_order_id": "SW-R-1", "items": [{"sku": "BR-1", "quantity": 2}], "prepaid": False}).encode()
    sig = hmac.new(channel["webhook_secret"].encode(), body, hashlib.sha256).hexdigest()
    placed = (await client.post(f"/api/v1/integrations/swiggy/orders/{tenant_id}", content=body,
                                headers={"X-Storant-Signature": sig, "Content-Type": "application/json"})).json()
    assert (await _stock(client, owner, p["id"]))["stock"] == 8
    resp = await client.post(f"/api/v1/orders/{placed['id']}/reject", headers=owner, json={"reason": "Kitchen closed"})
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == 10

    # Kitchen cancels a whole ticket
    order = (await _order(client, owner, p, 3)).json()
    assert (await _stock(client, owner, p["id"]))["stock"] == 7
    ticket = (await client.get("/api/v1/kitchen/tickets", headers=owner)).json()[0]
    resp = await client.put(f"/api/v1/kitchen/tickets/{ticket['id']}/status", headers=owner, json={"status": "cancelled"})
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == 10

    # Item removed before the kitchen, and a whole bill cancelled
    order = (await client.post("/api/v1/orders", headers=owner, json={
        "items": [{"product_id": p["id"], "quantity": 2}], "send_to_kitchen": False})).json()
    line = next(i for i in order["items"] if i["product_id"] == p["id"])
    await client.delete(f"/api/v1/orders/{order['id']}/items/{line['id']}", headers=owner)
    assert (await _stock(client, owner, p["id"]))["stock"] == 10
    order = (await _order(client, owner, p, 4)).json()
    await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=owner, json={"reason": "Wrong table"})
    assert (await _stock(client, owner, p["id"]))["stock"] == 10


@pytest.mark.asyncio
async def test_stock_stays_inside_one_business(client, fresh_tenant, tenant_b):
    owner = fresh_tenant["headers"]
    p = await _tracked(client, owner, "Secret Sherbet", 4)
    theirs = (await client.get("/api/v1/catalog/stock", headers=tenant_b["headers"])).json()
    assert all(i["id"] != p["id"] for i in theirs["items"])
    resp = await client.post("/api/v1/inventory/count", headers=tenant_b["headers"], json={"product_id": p["id"], "quantity": 99})
    assert resp.status_code == 404
    assert (await _stock(client, owner, p["id"]))["stock"] == 4


@pytest_asyncio.fixture
async def platform_admin(client):
    email = f"super_admin_{uuid.uuid4().hex[:8]}@example.com"
    async with get_shared_session_maker()() as db:
        db.add(GlobalUser(email=email, full_name="Test super admin", password_hash=get_password_hash("platformpass"), platform_role="super_admin"))
        await db.commit()
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": email, "password": "platformpass"})
    assert resp.status_code == 200, resp.text
    yield {"Authorization": f"Bearer {resp.json()['access_token']}"}
    async with get_shared_session_maker()() as db:
        await db.execute(delete(GlobalUser).where(GlobalUser.email == email))
        await db.commit()


@pytest.mark.asyncio
async def test_storant_archiving_or_deleting_a_bill_keeps_stock_right(client, fresh_tenant, platform_admin):
    owner, tenant_id = fresh_tenant["headers"], fresh_tenant["tenant_id"]
    p = await create_product(client, owner, "Roti", 20, tax_rate=0, track_stock=True, print_to_kitchen=True)
    await _count(client, owner, p["id"], 10)

    # An open bill archived by Storant is cancelled first: its stock comes back
    a = (await _order(client, owner, p, 3)).json()
    assert (await _stock(client, owner, p["id"]))["stock"] == 7
    resp = await client.post(f"/api/v1/platform/businesses/{tenant_id}/orders/archive", headers=platform_admin,
                             json={"order_ids": [a["id"]], "reason": "Training bill"})
    assert resp.status_code == 200, resp.text
    assert (await _stock(client, owner, p["id"]))["stock"] == 10

    # A bill with wastage deleted for good: the counter still equals the ledger afterwards
    b = (await _order(client, owner, p, 2)).json()
    line = next(i for i in b["items"] if i["product_id"] == p["id"])
    await client.post(f"/api/v1/orders/{b['id']}/items/void", headers=owner,
                      json={"items": [{"item_id": line["id"], "quantity": 1}], "reason": "Burnt", "waste": True})
    assert (await _stock(client, owner, p["id"]))["stock"] == 8
    resp = await client.post(f"/api/v1/platform/businesses/{tenant_id}/orders/delete", headers=platform_admin,
                             json={"order_ids": [b["id"]], "reason": "Duplicate", "confirm": "DELETE"})
    assert resp.status_code == 200, resp.text
    logs = (await client.get("/api/v1/inventory/logs", headers=owner, params={"product_id": p["id"]})).json()
    assert (await _stock(client, owner, p["id"]))["stock"] == sum(log["quantity_change"] for log in logs) == 10
