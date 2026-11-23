"""GET /tables/ready-to-serve: dine-in food that is ready but not served yet (floor staff's voice alerts and reminders)."""
import pytest
from tests.conftest import create_product, create_staff, create_tenant


async def _dine_in(client, owner, table_no, products, qty=1):
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": table_no})).json()
    order = (await client.post("/api/v1/orders", headers=owner, json={
        "items": [{"product_id": p["id"], "quantity": qty} for p in products], "order_type": "DINE_IN", "table_id": table["id"]})).json()
    return order, table


async def _status(client, headers, order, ids, status):
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/status", headers=headers, json={"item_ids": ids, "status": status})
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _ready(client, headers):
    resp = await client.get("/api/v1/tables/ready-to-serve", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.mark.asyncio
async def test_a_ticket_appears_only_when_every_live_item_is_ready_and_leaves_when_served(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    dal = await create_product(client, owner, "Dal", 100, tax_rate=0, print_to_kitchen=True)
    naan = await create_product(client, owner, "Naan", 30, tax_rate=0, print_to_kitchen=True)
    order, table = await _dine_in(client, owner, "5", [dal, naan], qty=2)
    ids = {i["name"]: i["id"] for i in order["items"]}

    body = await _ready(client, owner)
    assert body["items"] == [] and body["server_time"].endswith("Z")

    # One dish ready, the other still cooking: not yet
    await _status(client, owner, order, [ids["Dal"]], "ready")
    assert (await _ready(client, owner))["items"] == []

    # Both ready: one entry for the ticket
    await _status(client, owner, order, [ids["Naan"]], "ready")
    items = (await _ready(client, owner))["items"]
    assert len(items) == 1
    entry = items[0]
    assert entry["table_label"] == "5" and entry["table_id"] == table["id"] and entry["order_id"] == order["id"]
    assert entry["kot_id"] == order["items"][0]["kot_id"] and entry["ready_count"] == 4 and entry["ready_since"].endswith("Z")

    # Part served: still waiting for the rest
    await _status(client, owner, order, [ids["Dal"]], "served")
    assert (await _ready(client, owner))["items"][0]["ready_count"] == 2
    # All served: gone
    await _status(client, owner, order, [ids["Naan"]], "served")
    assert (await _ready(client, owner))["items"] == []


@pytest.mark.asyncio
async def test_cancelled_items_dont_count_and_a_new_kot_is_its_own_entry(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    dal = await create_product(client, owner, "Dal", 100, tax_rate=0, print_to_kitchen=True)
    roti = await create_product(client, owner, "Roti", 20, tax_rate=0, print_to_kitchen=True)
    order, _ = await _dine_in(client, owner, "7", [dal, roti])
    ids = {i["name"]: i["id"] for i in order["items"]}
    # The roti is cancelled (void) while the dal gets ready: the ticket is ready
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=owner,
                             json={"items": [{"item_id": ids["Roti"]}], "reason": "Customer changed mind"})
    assert resp.status_code == 200, resp.text
    await _status(client, owner, order, [ids["Dal"]], "ready")
    first = (await _ready(client, owner))["items"]
    assert len(first) == 1 and first[0]["ready_count"] == 1

    # "One more dal": a new KOT, its own entry once ready
    order = (await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner,
                               json={"items": [{"product_id": dal["id"], "quantity": 1}]})).json()
    new_line = next(i for i in order["items"] if i["kitchen_status"] == "pending")
    await _status(client, owner, order, [new_line["id"]], "ready")
    entries = (await _ready(client, owner))["items"]
    assert len(entries) == 2 and len({e["kot_id"] for e in entries}) == 2


@pytest.mark.asyncio
async def test_only_dine_in_and_only_running_bills(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    food = await create_product(client, owner, "Biryani", 200, tax_rate=0, print_to_kitchen=True)
    # Takeaway food that is ready never calls a waiter
    takeaway = (await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": food["id"], "quantity": 1}],
                                                                          "order_type": "TAKEAWAY"})).json()
    await _status(client, owner, takeaway, [takeaway["items"][0]["id"]], "ready")
    assert (await _ready(client, owner))["items"] == []

    # A cancelled dine-in bill drops out
    order, _ = await _dine_in(client, owner, "9", [food])
    await _status(client, owner, order, [order["items"][0]["id"]], "ready")
    assert len((await _ready(client, owner))["items"]) == 1
    await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=owner, json={"reason": "Left"})
    assert (await _ready(client, owner))["items"] == []


@pytest.mark.asyncio
async def test_floor_staff_see_it_the_kitchen_does_not_and_other_businesses_never(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    food = await create_product(client, owner, "Paneer", 150, tax_rate=0, print_to_kitchen=True)
    order, table = await _dine_in(client, owner, "3", [food])
    await _status(client, owner, order, [order["items"][0]["id"]], "ready")

    waiter = (await create_staff(client, owner, "waiter"))["headers"]
    cashier = (await create_staff(client, owner, "cashier"))["headers"]
    kitchen = (await create_staff(client, owner, "kitchen"))["headers"]
    assert len((await _ready(client, waiter))["items"]) == 1
    assert len((await _ready(client, cashier))["items"]) == 1
    assert (await client.get("/api/v1/tables/ready-to-serve", headers=kitchen)).status_code == 403

    other = await create_tenant(client, "otherfloor")
    assert (await _ready(client, other["headers"]))["items"] == []
