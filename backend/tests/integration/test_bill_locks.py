"""Bills that are paid or part-paid take no more items, and two people working on one bill go one after the other
(the bill's row is locked while a payment or a change is saved)."""
import asyncio
import pytest
from tests.conftest import create_product


async def _takeaway(client, owner, price=100):
    product = await create_product(client, owner, "Lassi", price, tax_rate=0)  # not a kitchen item: no pay rule involved
    order = (await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": product["id"], "quantity": 1}],
                                                                       "order_type": "TAKEAWAY"})).json()
    return order, product


def _add(product, qty=1):
    return {"items": [{"product_id": product["id"], "quantity": qty}]}


@pytest.mark.asyncio
async def test_a_paid_bill_says_start_a_new_order(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    order, product = await _takeaway(client, owner)
    assert (await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner,
                              json={"payments": [{"method": "CASH", "amount": 100}]})).status_code == 200

    resp = await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner, json=_add(product))
    assert resp.status_code == 409
    error = resp.json()["error"]
    assert error["code"] == "BILL_CLOSED" and error["message"] == "This bill is paid. Start a new order."
    assert error["details"] == {"status": "completed"}

    # Paying it again, or changing it, says the same
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 1}]})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "BILL_CLOSED"
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/void", headers=owner, json={"items": [{"item_id": order["items"][0]["id"]}]})
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "BILL_CLOSED"


@pytest.mark.asyncio
async def test_a_cancelled_bill_says_it_was_cancelled(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    order, product = await _takeaway(client, owner)
    await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=owner, json={"reason": "Customer left"})
    resp = await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner, json=_add(product))
    assert resp.status_code == 409 and resp.json()["error"]["details"] == {"status": "cancelled"}
    assert "cancelled" in resp.json()["error"]["message"]


@pytest.mark.asyncio
async def test_no_items_after_a_part_payment(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    order, product = await _takeaway(client, owner)
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "UPI", "amount": 40}]})
    assert resp.json()["payment_status"] == "partial"

    resp = await client.post(f"/api/v1/orders/{order['id']}/items", headers=owner, json=_add(product))
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "BILL_PART_PAID"
    # The rest of the money can still be collected
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 60}]})
    assert resp.status_code == 200 and resp.json()["status"] == "completed"


@pytest.mark.asyncio
async def test_adding_items_while_the_bill_is_being_paid_goes_one_after_the_other(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    for _ in range(3):  # a few rounds: whichever request wins, the bill must stay consistent
        order, product = await _takeaway(client, owner)
        add, pay = await asyncio.gather(
            client.post(f"/api/v1/orders/{order['id']}/items", headers=owner, json=_add(product, 2)),
            client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": 100}]}),
        )
        assert pay.status_code == 200, pay.text
        final = (await client.get(f"/api/v1/orders/{order['id']}", headers=owner)).json()
        paid = sum(p["amount"] for p in final["payments"])
        if add.status_code == 200:
            # The items went on first: the payment covered only part of the bigger bill, which stays open
            assert final["status"] == "open" and final["payment_status"] == "partial"
            assert final["total_amount"] == 300.0 and paid == 100.0
        else:
            # The payment went first: the bill closed with exactly what was paid, and the items were refused clearly
            assert add.status_code == 409 and add.json()["error"]["code"] == "BILL_CLOSED"
            assert final["status"] == "completed" and final["total_amount"] == 100.0 and paid == 100.0
            assert len([i for i in final["items"] if not i["is_void"]]) == 1


@pytest.mark.asyncio
async def test_split_and_merge_still_work_with_locks(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    product = await create_product(client, owner, "Soda", 40, tax_rate=0)
    table = (await client.post("/api/v1/tables", headers=owner, json={"table_number": "L1"})).json()
    order = (await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": product["id"], "quantity": 2}],
                                                                       "order_type": "DINE_IN", "table_id": table["id"]})).json()
    resp = await client.post(f"/api/v1/orders/{order['id']}/items/move", headers=owner,
                             json={"items": [{"item_id": order["items"][0]["id"], "quantity": 1}], "new_bill_label": "Asha"})
    assert resp.status_code == 200, resp.text
    target = resp.json()["target"]
    resp = await client.post(f"/api/v1/orders/{order['id']}/merge", headers=owner, json={"source_order_id": target["id"]})
    assert resp.status_code == 200 and resp.json()["total_amount"] == 80.0
    # The merged bill is closed: adding to it points to the other bill
    resp = await client.post(f"/api/v1/orders/{target['id']}/items", headers=owner, json=_add(product))
    assert resp.status_code == 409 and resp.json()["error"]["details"] == {"status": "merged"}
