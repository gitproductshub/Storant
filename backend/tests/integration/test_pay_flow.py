"""Dine-in pay flow: when a bill may be paid (pay rules), who may mark items served, Bump vs served, Pay anyway."""
import pytest
import uuid
from datetime import datetime, timezone
from tests.conftest import create_product, create_staff, create_tenant, serve_all


@pytest.mark.asyncio
async def test_pay_rules_default_and_validation(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    s = (await client.get("/api/v1/settings", headers=owner)).json()
    assert s["pay_rules"] == {"DINE_IN": "served", "TAKEAWAY": "anytime", "DELIVERY": "anytime", "RETAIL_WALKIN": "anytime"}
    assert s["bump_marks_served"] is False
    assert s["order_types"] == ["DINE_IN", "TAKEAWAY", "DELIVERY"]  # a restaurant: no counter walk-in

    resp = await client.put("/api/v1/settings", headers=owner, json={"pay_rules": {"TAKEAWAY": "ready"}})
    assert resp.status_code == 200, resp.text
    # Saving one order type keeps the others (dine-in default still applies)
    assert resp.json()["pay_rules"] == {"DINE_IN": "served", "TAKEAWAY": "ready", "DELIVERY": "anytime", "RETAIL_WALKIN": "anytime"}

    resp = await client.put("/api/v1/settings", headers=owner, json={"pay_rules": {"DINE_IN": "anytime"}, "bump_marks_served": True})
    body = resp.json()
    assert body["pay_rules"]["DINE_IN"] == "anytime" and body["pay_rules"]["TAKEAWAY"] == "ready"
    assert body["bump_marks_served"] is True

    assert (await client.put("/api/v1/settings", headers=owner, json={"pay_rules": {"DINE_IN": "later"}})).status_code == 422
    assert (await client.put("/api/v1/settings", headers=owner, json={"pay_rules": {"PICNIC": "served"}})).status_code == 422
    # null leaves the switch as it was
    assert (await client.put("/api/v1/settings", headers=owner, json={"bump_marks_served": None})).json()["bump_marks_served"] is True


@pytest.mark.asyncio
async def test_retail_business_shows_counter_order_type(client):
    shop = await create_tenant(client, "retailshop", business_type="retail")
    s = (await client.get("/api/v1/settings", headers=shop["headers"])).json()
    assert "RETAIL_WALKIN" in s["order_types"] and "DINE_IN" not in s["order_types"]


@pytest.mark.asyncio
async def test_serve_and_pay_override_permissions_by_role(client, fresh_tenant):
    owner = fresh_tenant["headers"]

    async def perms(headers) -> set:
        return set((await client.get("/api/v1/access/me", headers=headers)).json()["permissions"])

    assert {"kitchen.serve", "orders.pay_override"} <= await perms(owner)
    manager, cashier, waiter, kitchen = [await create_staff(client, owner, r) for r in ("manager", "cashier", "waiter", "kitchen")]
    assert {"kitchen.serve", "orders.pay_override"} <= await perms(manager["headers"])
    cashier_perms, waiter_perms, kitchen_perms = await perms(cashier["headers"]), await perms(waiter["headers"]), await perms(kitchen["headers"])
    assert "kitchen.serve" in cashier_perms and "orders.pay_override" not in cashier_perms
    assert "kitchen.serve" in waiter_perms and "orders.pay_override" not in waiter_perms
    assert "kitchen.serve" not in kitchen_perms and "kitchen.update" in kitchen_perms

    # The roles editor lists both new permissions
    catalog = (await client.get("/api/v1/access/permissions", headers=owner)).json()
    codes = {p["code"] for g in catalog for p in g["permissions"]}
    assert {"kitchen.serve", "orders.pay_override"} <= codes


# --- Phase 2: Bump only clears the ticket; only floor staff serve ------------------------------------------------------

async def _setup_kitchen(client, owner, order_type="DINE_IN"):
    food = await create_product(client, owner, f"Dish {order_type}", 100, tax_rate=0, print_to_kitchen=True)
    body = {"items": [{"product_id": food["id"], "quantity": 2}], "order_type": order_type}
    if order_type == "DINE_IN":
        table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "K1"})).json()
        body["table_id"] = table["id"]
    resp = await client.post("/api/v1/orders", headers=owner, json=body)
    assert resp.status_code == 200, resp.text
    order = resp.json()
    kot_id = order["items"][0]["kot_id"]
    assert kot_id
    return order, kot_id


async def _active(client, headers):
    return [t["id"] for t in (await client.get("/api/v1/kitchen/tickets", headers=headers)).json()]


async def _item_statuses(client, headers, order_id):
    order = (await client.get(f"/api/v1/orders/{order_id}", headers=headers)).json()
    return [i["kitchen_status"] for i in order["items"] if not i["is_void"]]


@pytest.mark.asyncio
async def test_bump_keeps_dine_in_food_ready_until_a_waiter_serves_it(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    waiter = (await create_staff(client, owner, "waiter"))["headers"]
    order, kot = await _setup_kitchen(client, owner)

    # Nothing to bump while the food is still cooking
    assert (await client.post(f"/api/v1/kitchen/tickets/{kot}/bump", headers=kitchen)).status_code == 409
    for status in ("preparing", "ready"):
        assert (await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": status})).status_code == 200

    resp = await client.post(f"/api/v1/kitchen/tickets/{kot}/bump", headers=kitchen)
    assert resp.status_code == 200, resp.text
    assert resp.json()["served"] is False and resp.json()["bumped_at"]
    assert kot not in await _active(client, kitchen)  # gone from the kitchen screen…
    assert await _item_statuses(client, owner, order["id"]) == ["ready"]  # …but the food still waits for the waiter
    recent = (await client.get("/api/v1/kitchen/tickets", headers=kitchen, params={"status": "recent"})).json()
    assert recent[0]["id"] == kot and recent[0]["bumped_at"]

    # The kitchen can't serve; the waiter can
    item_ids = [i["id"] for i in order["items"]]
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=kitchen, json={"item_ids": item_ids, "status": "served"})
    assert resp.status_code == 403
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=waiter, json={"item_ids": item_ids, "status": "served"})
    assert resp.status_code == 200, resp.text
    assert await _item_statuses(client, owner, order["id"]) == ["served"]

    # Recall brings the ticket back; what the waiter served stays served
    resp = await client.post(f"/api/v1/kitchen/tickets/{kot}/recall", headers=kitchen)
    assert resp.status_code == 200 and resp.json()["status"] == "served"
    assert await _item_statuses(client, owner, order["id"]) == ["served"]


@pytest.mark.asyncio
async def test_recall_after_a_bump_puts_the_ticket_back_on_screen(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    order, kot = await _setup_kitchen(client, owner)
    await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": "ready"})
    await client.post(f"/api/v1/kitchen/tickets/{kot}/bump", headers=kitchen)
    assert kot not in await _active(client, kitchen)

    assert (await client.post(f"/api/v1/kitchen/tickets/{kot}/recall", headers=kitchen)).status_code == 200
    tickets = (await client.get("/api/v1/kitchen/tickets", headers=kitchen)).json()
    assert [(t["id"], t["status"]) for t in tickets] == [(kot, "ready")]

    # Bumped again, then a dish goes back to cooking: the ticket returns to the screen by itself
    await client.post(f"/api/v1/kitchen/tickets/{kot}/bump", headers=kitchen)
    await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=owner,
                      json={"item_ids": [order["items"][0]["id"]], "status": "preparing"})
    assert kot in await _active(client, kitchen)


@pytest.mark.asyncio
async def test_bump_serves_takeaway_food_and_recall_undoes_it(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    order, kot = await _setup_kitchen(client, owner, order_type="TAKEAWAY")
    await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": "ready"})
    resp = await client.post(f"/api/v1/kitchen/tickets/{kot}/bump", headers=kitchen)
    assert resp.json()["served"] is True and resp.json()["status"] == "served"
    assert await _item_statuses(client, owner, order["id"]) == ["served"]

    await client.post(f"/api/v1/kitchen/tickets/{kot}/recall", headers=kitchen)
    assert await _item_statuses(client, owner, order["id"]) == ["ready"]
    assert kot in await _active(client, kitchen)


@pytest.mark.asyncio
async def test_bump_marks_served_setting_serves_dine_in(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    await client.put("/api/v1/settings", headers=owner, json={"bump_marks_served": True})
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    order, kot = await _setup_kitchen(client, owner)
    await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": "ready"})
    assert (await client.post(f"/api/v1/kitchen/tickets/{kot}/bump", headers=kitchen)).json()["served"] is True
    assert await _item_statuses(client, owner, order["id"]) == ["served"]


@pytest.mark.asyncio
async def test_old_app_bump_is_a_bump_for_the_kitchen_and_a_real_serve_for_floor_staff(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    cashier = (await create_staff(client, owner, "cashier"))["headers"]

    order, kot = await _setup_kitchen(client, owner)
    await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": "ready"})
    resp = await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": "served"})
    assert resp.status_code == 200 and resp.json()["status"] == "ready" and resp.json()["bumped_at"]
    assert kot not in await _active(client, kitchen)
    assert await _item_statuses(client, owner, order["id"]) == ["ready"]
    # The old app's Undo (back to ready) brings it back
    await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": "ready"})
    assert kot in await _active(client, kitchen)

    # Someone with kitchen.serve really serves it
    resp = await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=cashier, json={"status": "served"})
    assert resp.status_code == 200 and resp.json()["status"] == "served"
    assert await _item_statuses(client, owner, order["id"]) == ["served"]


@pytest.mark.asyncio
async def test_floor_staff_serve_straight_from_pending_and_the_kitchen_never_unserves(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    waiter = (await create_staff(client, owner, "waiter"))["headers"]
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    a = await create_product(client, owner, "Idli", 40, tax_rate=0, print_to_kitchen=True)
    b = await create_product(client, owner, "Vada", 40, tax_rate=0, print_to_kitchen=True)
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "S1"})).json()
    order = (await client.post("/api/v1/orders", headers=owner, json={
        "items": [{"product_id": a["id"], "quantity": 1}, {"product_id": b["id"], "quantity": 1}],
        "order_type": "DINE_IN", "table_id": table["id"]})).json()
    idli = next(i for i in order["items"] if i["name"] == "Idli")

    # No kitchen screen in this place: the waiter serves the idli while it is still "pending"
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=waiter, json={"item_ids": [idli["id"]], "status": "served"})
    assert resp.status_code == 200, resp.text
    # The kitchen readies the ticket: the vada becomes ready, the served idli stays served
    await client.put(f"/api/v1/kitchen/tickets/{idli['kot_id']}/status", headers=kitchen, json={"status": "ready"})
    order = (await client.get(f"/api/v1/orders/{order['id']}", headers=owner)).json()
    assert {i["name"]: i["kitchen_status"] for i in order["items"]} == {"Idli": "served", "Vada": "ready"}


# --- Phase 4: the server stops payment until the food is served (dine-in) ----------------------------------------------

async def _dine_in(client, owner, table_no="P1", kitchen=True, qty=2, **extra):
    dish = await create_product(client, owner, f"Paneer {table_no}", 100, tax_rate=0, print_to_kitchen=kitchen)
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": table_no})).json()
    resp = await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": dish["id"], "quantity": qty}],
                                                                     "order_type": "DINE_IN", "table_id": table["id"], **extra})
    return resp, dish, table


def _pay(amount=200, **extra):
    return {"payments": [{"method": "CASH", "amount": amount}], **extra}


@pytest.mark.asyncio
async def test_dine_in_bill_is_paid_only_after_the_food_is_served(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    cashier = (await create_staff(client, owner, "cashier"))["headers"]
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    resp, _, _ = await _dine_in(client, owner)
    order = resp.json()

    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=cashier, json=_pay())
    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["code"] == "PAY_BLOCKED_ITEMS" and error["message"].startswith("2 items not served yet")
    assert error["details"] == {"level": "served", "order_type": "DINE_IN", "unsent": 0, "cooking": 2, "ready": 0, "blocking": 2}

    # Ready in the kitchen is not enough: it must reach the table
    kot = order["items"][0]["kot_id"]
    await client.put(f"/api/v1/kitchen/tickets/{kot}/status", headers=kitchen, json={"status": "ready"})
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=cashier, json=_pay())
    assert resp.status_code == 409 and resp.json()["error"]["details"]["ready"] == 2

    await serve_all(client, cashier, order["id"])
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=cashier, json=_pay())
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_more_items_after_the_first_kot_block_payment_again(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp, dish, _ = await _dine_in(client, owner, qty=1)
    order = resp.json()
    await serve_all(client, owner, order["id"])
    # "One more, please": a new KOT, pending again
    order = (await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner,
                               json={"items": [{"product_id": dish["id"], "quantity": 1}]})).json()
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay())
    assert resp.status_code == 409 and resp.json()["error"]["details"]["blocking"] == 1
    await serve_all(client, owner, order["id"])
    assert (await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay())).status_code == 200


@pytest.mark.asyncio
async def test_pay_anyway_is_for_owner_and_manager_with_a_reason(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    cashier = (await create_staff(client, owner, "cashier"))["headers"]
    manager = (await create_staff(client, owner, "manager"))["headers"]
    resp, _, _ = await _dine_in(client, owner)
    order = resp.json()

    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=cashier, json=_pay(override_reason="Customer in a hurry"))
    assert resp.status_code == 403
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=manager, json=_pay(override_reason="ok"))
    assert resp.status_code == 422  # a real reason is needed
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=manager, json=_pay(override_reason="Customer in a hurry"))
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "completed"

    watch = (await client.get("/api/v1/owner/watch", headers=owner)).json()
    event = next(e for e in watch["events"] if e["action"] == "order.pay_override")
    assert event["order_id"] == order["id"] and "Customer in a hurry" in event["summary"]


@pytest.mark.asyncio
async def test_new_dine_in_bill_with_payment_must_be_served_first(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp, _, table = await _dine_in(client, owner, table_no="P2", payments=[{"method": "CASH", "amount": 200}])
    assert resp.status_code == 409 and resp.json()["error"]["details"]["unsent"] == 0
    assert resp.json()["error"]["details"]["cooking"] == 2
    # Nothing was saved: the table is still free
    tables = {t["id"]: t for t in (await client.get("/api/v1/tables", headers=owner)).json()}
    assert tables[table["id"]]["status"] == "free"

    # Items that don't go to the kitchen (a cold drink) never hold up the bill
    resp, _, _ = await _dine_in(client, owner, table_no="P3", kitchen=False, payments=[{"method": "CASH", "amount": 200}])
    assert resp.status_code == 200 and resp.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_kitchen_items_not_sent_yet_hold_the_bill(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp, dish, _ = await _dine_in(client, owner, qty=1)
    order = resp.json()
    await serve_all(client, owner, order["id"])
    # Added but kept back from the kitchen ("send later")
    await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner,
                      json={"items": [{"product_id": dish["id"], "quantity": 1}], "send_to_kitchen": False})
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay())
    assert resp.status_code == 409 and resp.json()["error"]["details"]["unsent"] == 1
    assert "not sent to the kitchen" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_takeaway_and_owner_rules(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    dish = await create_product(client, owner, "Biryani", 200, tax_rate=0, print_to_kitchen=True)
    # Takeaway pays first (default "anytime")
    resp = await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": dish["id"], "quantity": 1}],
                                                                     "order_type": "TAKEAWAY", "payments": [{"method": "UPI", "amount": 200}]})
    assert resp.status_code == 200 and resp.json()["status"] == "completed"

    # Owner chooses "after items are ready" for dine-in: ready is enough
    await client.put("/api/v1/settings", headers=owner, json={"pay_rules": {"DINE_IN": "ready"}})
    resp, _, _ = await _dine_in(client, owner, table_no="R1", qty=1)
    order = resp.json()
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay(100))
    assert resp.status_code == 409 and "not ready yet" in resp.json()["error"]["message"]
    await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=owner, json={"item_ids": [order["items"][0]["id"]], "status": "ready"})
    assert (await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay(100))).status_code == 200

    # …or "anytime": no check at all
    await client.put("/api/v1/settings", headers=owner, json={"pay_rules": {"DINE_IN": "anytime"}})
    resp, _, _ = await _dine_in(client, owner, table_no="R2", qty=1, payments=[{"method": "CASH", "amount": 100}])
    assert resp.status_code == 200 and resp.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_part_paid_bill_can_always_be_finished(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp, _, _ = await _dine_in(client, owner)
    order = resp.json()
    await serve_all(client, owner, order["id"])
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay(50))
    assert resp.status_code == 200 and resp.json()["payment_status"] == "partial"
    # The kitchen sends one dish back to cooking; the rest of the money can still be taken
    await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=owner, json={"item_ids": [order["items"][0]["id"]], "status": "preparing"})
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay(150))
    assert resp.status_code == 200 and resp.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_no_check_without_the_kitchen_module(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    resp, _, _ = await _dine_in(client, owner)
    order = resp.json()
    assert (await client.put("/api/v1/modules", headers=owner, json={"hidden": ["kitchen"]})).status_code == 200
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json=_pay())
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_offline_dine_in_bill_paid_before_serving_still_syncs(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    dish = await create_product(client, owner, "Kadhai", 150, tax_rate=0, print_to_kitchen=True)
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "OFF1"})).json()
    order_id = str(uuid.uuid4())
    resp = await client.post("/api/v1/sync/push", headers=owner, json={"orders": [{
        "id": order_id, "order_type": "DINE_IN", "table_id": table["id"], "items": [{"product_id": dish["id"], "quantity": 1}],
        "payments": [{"method": "CASH", "amount": 150}], "created_at": datetime.now(timezone.utc).isoformat()}]})
    assert resp.status_code == 200, resp.text
    result = resp.json()["results"][0]
    assert result["status"] == "ok", result
    assert result["order"]["status"] == "completed"
