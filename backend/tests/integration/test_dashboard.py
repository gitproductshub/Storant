"""Home dashboard: plan features (Phase 1) and the /dashboard endpoint (Phase 2).

Each API test uses a fresh business: the dashboard caches results for a few seconds per business.
"""
import asyncio
import time
import uuid
import pytest
import pytest_asyncio
from sqlalchemy import delete
from tests.conftest import create_product, create_staff, random_client_ip, serve_all
from app.core.catalog import ALL_FEATURES, DEFAULT_PLANS, FEATURES, SYSTEM_ROLES, feature_group
from app.core.security import get_password_hash
from app.core.tenant import get_redis_client, get_shared_session_maker
from app.models import GlobalUser, Plan
from app.services import dashboard_cache
from app.services.access import Access
from app.services.dashboard import WIDGETS, select_widgets

DASHBOARD_KEYS = {"dashboard_insights", "dashboard_live"}
MONEY_KEYS = {"value", "sales", "collected", "gross_sales", "average_order_value", "average_bill", "total", "amount", "by_method"}


async def _super_admin_login(client) -> dict:
    email = f"super_admin_{uuid.uuid4().hex[:8]}@example.com"
    async with get_shared_session_maker()() as db:
        db.add(GlobalUser(email=email, full_name="Test super admin", password_hash=get_password_hash("platformpass"), platform_role="super_admin"))
        await db.commit()
    resp = await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": email, "password": "platformpass"})
    assert resp.status_code == 200, resp.text
    return {"Authorization": f"Bearer {resp.json()['access_token']}", "email": email}


@pytest_asyncio.fixture
async def platform_admin(client):
    headers = await _super_admin_login(client)
    yield {"Authorization": headers["Authorization"]}
    async with get_shared_session_maker()() as db:
        await db.execute(delete(GlobalUser).where(GlobalUser.email == headers["email"]))
        await db.commit()


# --- Phase 1: plan features ------------------------------------------------------------------------------------

def test_dashboard_features_are_in_their_own_group():
    assert DASHBOARD_KEYS <= set(FEATURES)
    assert {feature_group(k) for k in DASHBOARD_KEYS} == {"dashboard"}
    assert feature_group("tables") == "modules"
    plans = {p["key"]: set(p["features"]) for p in DEFAULT_PLANS}
    assert DASHBOARD_KEYS <= plans["pro"]
    assert "dashboard_live" in plans["standard"] and "dashboard_insights" not in plans["standard"]
    assert not DASHBOARD_KEYS & plans["basic"]


@pytest.mark.asyncio
async def test_plan_editor_lists_dashboard_group_and_saves_it(client, platform_admin):
    body = (await client.get("/api/v1/platform/plans", headers=platform_admin)).json()
    groups = {f["key"]: f["group"] for f in body["features"]}
    assert groups["dashboard_insights"] == "dashboard" and groups["dashboard_live"] == "dashboard" and groups["reports"] == "modules"
    plans = {p["key"]: set(p["features"]) for p in body["plans"]}
    assert DASHBOARD_KEYS <= plans["pro"]  # default plan rows get the keys (seeded, or migration 0066)
    assert "dashboard_live" in plans["standard"]

    key = f"dash{uuid.uuid4().hex[:8]}"
    resp = await client.post("/api/v1/platform/plans", headers=platform_admin, json={
        "key": key, "name": "Dash test", "price_monthly": 0, "features": ["reports", "dashboard_insights"],
        "limits": {"max_staff": 2, "max_products": 100, "max_locations": 1}, "is_active": False, "sort_order": 99})
    assert resp.status_code == 200, resp.text
    saved = next(p for p in resp.json()["plans"] if p["key"] == key)
    assert "dashboard_insights" in saved["features"] and "dashboard_live" not in saved["features"]
    async with get_shared_session_maker()() as db:
        await db.execute(delete(Plan).where(Plan.key == key))
        await db.commit()


@pytest.mark.asyncio
async def test_business_sees_dashboard_features_and_groups(client, fresh_tenant, platform_admin):
    owner = fresh_tenant["headers"]
    me = (await client.get("/api/v1/access/me", headers=owner)).json()
    assert DASHBOARD_KEYS <= set(me["features"])  # new businesses start on Pro
    modules = {m["key"]: m for m in (await client.get("/api/v1/modules", headers=owner)).json()["modules"]}
    assert modules["dashboard_live"]["group"] == "dashboard" and modules["tables"]["group"] == "modules"

    # A per-business override switches one off without touching the plan
    tenant_id = fresh_tenant["tenant_id"]
    resp = await client.put(f"/api/v1/platform/businesses/{tenant_id}", headers=platform_admin,
                            json={"feature_overrides": {"dashboard_insights": False}})
    assert resp.status_code == 200, resp.text
    detail = (await client.get(f"/api/v1/platform/businesses/{tenant_id}", headers=platform_admin)).json()
    assert "dashboard_insights" not in detail["effective_features"]
    assert any(f["key"] == "dashboard_insights" and f["group"] == "dashboard" for f in detail["features_catalog"])


# --- Phase 2: /dashboard ----------------------------------------------------------------------------------------

def _access(role: str, permissions=None, features=ALL_FEATURES, staff_id="00000000-0000-0000-0000-000000000001") -> Access:
    perms = frozenset(permissions if permissions is not None else SYSTEM_ROLES[role]["permissions"])
    return Access(user_id="u", tenant_id="t", role=role, staff_id=staff_id, staff_name="Test", permissions=perms, features=frozenset(features))


def _keys(access: Access, business_type: str = "restaurant") -> list[str]:
    return [w.key for w in select_widgets(access, business_type)[0]]


def _money_keys(value) -> set:
    """Every money-looking key anywhere in a response."""
    found = set()
    if isinstance(value, dict):
        for k, v in value.items():
            if k in MONEY_KEYS:
                found.add(k)
            found |= _money_keys(v)
    elif isinstance(value, list):
        for v in value:
            found |= _money_keys(v)
    return found


def test_every_widget_declares_a_plan_feature_key():
    for w in WIDGETS.values():
        assert w.plan_feature is None or w.plan_feature in ALL_FEATURES, w.key


OWNER_ALL = ["today_sales", "payment_split", "open_bills", "floor_live", "payment_claims", "ready_to_pay", "ready_to_serve", "kitchen",
             "kitchen_delays", "hourly_sales", "top_items", "voids_comps", "low_stock"]
INSIGHT_KEYS = ["payment_split", "hourly_sales", "top_items", "voids_comps"]
LIVE_KEYS = ["floor_live", "kitchen_delays"]


def test_widgets_follow_permissions_features_and_business_type():
    assert _keys(_access("owner")) == OWNER_ALL
    assert _keys(_access("waiter")) == ["my_tables", "ready_to_serve", "my_day"]
    assert _keys(_access("kitchen")) == ["kitchen"]
    assert _keys(_access("cashier")) == ["ready_to_pay", "payment_claims", "open_bills", "my_collection", "my_day"]
    # Retail: no tables, kitchen, claims or ready-to-pay (sales insights yes)
    assert _keys(_access("owner"), "retail") == ["today_sales", "payment_split", "open_bills", "hourly_sales", "top_items", "voids_comps", "low_stock"]
    # Cloud kitchen: kitchen yes, tables no
    assert "kitchen" in _keys(_access("manager"), "cloud_kitchen") and "ready_to_serve" not in _keys(_access("manager"), "cloud_kitchen")
    # Plan without tables: no table widgets for the waiter
    assert _keys(_access("waiter", features=ALL_FEATURES - {"tables"})) == ["my_day"]
    # No staff record: no "my" widgets
    assert _keys(_access("waiter", staff_id=None)) == ["ready_to_serve"]


def test_custom_roles_get_a_persona_from_their_permissions():
    assert _keys(_access("billing_desk", ["orders.create", "orders.pay"])) == ["ready_to_pay", "payment_claims", "open_bills", "my_collection"]
    assert _keys(_access("runner", ["tables.view", "orders.create"])) == ["my_tables", "ready_to_serve"]
    assert _keys(_access("menu_only", ["menu.view"])) == []
    assert _keys(_access("supervisor", ["reports.view", "kitchen.view"])) == ["kitchen_delays", "kitchen", "today_sales", "voids_comps"]


def test_plan_without_dashboard_extras_gives_the_owner_one_locked_list():
    basic_plan = ALL_FEATURES - DASHBOARD_KEYS
    owner = _access("owner", features=basic_plan)
    shown, locked = select_widgets(owner, "restaurant")
    assert [w.key for w in shown] == [k for k in OWNER_ALL if k not in INSIGHT_KEYS + LIVE_KEYS]
    assert locked == ["payment_split", "floor_live", "kitchen_delays", "hourly_sales", "top_items", "voids_comps"]
    # Staff never get a locked list
    assert select_widgets(_access("manager", features=basic_plan), "restaurant")[1] == []
    # Only the live monitor in the plan (Standard): insights locked, live shown
    shown, locked = select_widgets(_access("owner", features=ALL_FEATURES - {"dashboard_insights"}), "restaurant")
    assert "floor_live" in [w.key for w in shown] and locked == INSIGHT_KEYS


async def _dine_in(client, headers, table_number: str, product: dict, quantity: int = 1, table_headers: dict | None = None) -> dict:
    """A new table (made by `table_headers`, default the same person) and a dine-in bill on it, sent to the kitchen."""
    resp = await client.post("/api/v1/tables", headers=table_headers or headers, json={"table_number": table_number})
    assert resp.status_code == 200, resp.text
    table = resp.json()
    resp = await client.post("/api/v1/orders", headers=headers, json={"items": [{"product_id": product["id"], "quantity": quantity}],
                                                                      "order_type": "DINE_IN", "table_id": table["id"]})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _widget(body: dict, key: str) -> dict:
    w = next((w for w in body["widgets"] if w["key"] == key), None)
    assert w is not None, f"{key} missing from {[x['key'] for x in body['widgets']]}"
    assert "error" not in w, w
    return w["data"]


async def _forget_cache(tenant_id: str) -> None:
    """Drop this business's cached widgets (local and Redis) so the next call recomputes."""
    dashboard_cache.reset_for_tests()
    try:
        redis = await get_redis_client()
        keys = [k async for k in redis.scan_iter(f"{dashboard_cache.PREFIX}{tenant_id}:*")]
        if keys:
            await redis.delete(*keys)
    except Exception:
        pass


@pytest.mark.asyncio
async def test_owner_sees_the_same_numbers_as_reports(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    product = await create_product(client, owner, "Thali", 150, tax_rate=0, print_to_kitchen=True)  # goes to the kitchen (KOT)
    order = (await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": product["id"], "quantity": 2}],
                                                                       "order_type": "TAKEAWAY"})).json()
    resp = await client.post(f"/api/v1/orders/{order['id']}/pay", headers=owner, json={"payments": [{"method": "CASH", "amount": order["total_amount"]}]})
    assert resp.status_code == 200, resp.text
    await _dine_in(client, owner, "D1", product)

    body = (await client.get("/api/v1/dashboard", headers=owner)).json()
    assert body["persona"] == "owner" and body["locked"] == []
    assert [w["key"] for w in body["widgets"]] == OWNER_ALL
    summary = (await client.get("/api/v1/reports/summary", headers=owner)).json()
    sales = _widget(body, "today_sales")
    assert (sales["orders"], sales["gross_sales"], sales["average_order_value"]) == (summary["orders"], summary["gross_sales"], summary["average_order_value"])
    split = _widget(body, "payment_split")
    assert sorted(split["by_method"], key=lambda r: r["method"]) == sorted(summary["by_payment"], key=lambda r: r["method"])
    assert _widget(body, "hourly_sales")["hourly"] == summary["hourly"]
    assert _widget(body, "top_items")["items"] == summary["top_items"][:5]
    floor = _widget(body, "floor_live")
    assert floor["occupied"] == 1 and floor["total"] == 1 and floor["longest"]["table_label"] == "D1"
    assert _widget(body, "kitchen_delays")["cooking"] >= 1
    open_bills = _widget(body, "open_bills")
    assert open_bills["count"] == summary["open_orders"] and open_bills["value"] == summary["open_value"]
    assert open_bills["tables_occupied"] == 1
    assert _widget(body, "kitchen")["pending"] >= 1


@pytest.mark.asyncio
async def test_waiter_gets_their_tables_and_never_money(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    waiter = await create_staff(client, owner, "waiter")
    product = await create_product(client, owner, "Dosa", 90, tax_rate=0, print_to_kitchen=True)
    await _dine_in(client, waiter["headers"], "W5", product, quantity=2, table_headers=owner)

    body = (await client.get("/api/v1/dashboard", headers=waiter["headers"])).json()
    assert body["persona"] == "waiter"
    assert [w["key"] for w in body["widgets"]] == ["my_tables", "ready_to_serve", "my_day"]
    assert _money_keys(body) == set(), _money_keys(body)
    tables = _widget(body, "my_tables")
    assert tables["running"] == 1 and tables["tables"][0]["label"] == "W5" and tables["tables"][0]["kitchen"]["pending"] == 2
    # Asking for widgets the waiter may not see gives nothing
    only = (await client.get("/api/v1/dashboard", headers=waiter["headers"], params={"widgets": "today_sales,open_bills"})).json()
    assert only["widgets"] == []


@pytest.mark.asyncio
async def test_kitchen_and_cashier_dashboards(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    kitchen = await create_staff(client, owner, "kitchen")
    cashier = await create_staff(client, owner, "cashier")
    product = await create_product(client, owner, "Paneer Tikka", 200, tax_rate=0, print_to_kitchen=True)
    order = await _dine_in(client, owner, "K1", product, quantity=3)

    body = (await client.get("/api/v1/dashboard", headers=kitchen["headers"])).json()
    assert body["persona"] == "kitchen" and [w["key"] for w in body["widgets"]] == ["kitchen"]
    data = _widget(body, "kitchen")
    assert data["pending"] == 1 and data["oldest_at"]
    assert data["to_prepare"][0] == {"name": "Paneer Tikka", "variant": None, "quantity": 3}
    assert _money_keys(body) == set()

    before = _widget((await client.get("/api/v1/dashboard", headers=cashier["headers"])).json(), "ready_to_pay")
    assert before["count"] == 0  # food not served yet (dine-in is paid after it is served)
    await serve_all(client, owner, order["id"])
    await _forget_cache(fresh_tenant["tenant_id"])
    body = (await client.get("/api/v1/dashboard", headers=cashier["headers"], params={"widgets": "ready_to_pay"})).json()
    assert [w["key"] for w in body["widgets"]] == ["ready_to_pay"]
    ready = _widget(body, "ready_to_pay")
    assert ready["count"] == 1 and ready["bills"][0]["table_label"] == "K1" and ready["value"] == order["total_amount"]


@pytest.mark.asyncio
async def test_one_business_never_sees_another(client, fresh_tenant, tenant_b):
    owner = fresh_tenant["headers"]
    product = await create_product(client, owner, "Secret Biryani", 250, tax_rate=0)
    await _dine_in(client, owner, "S1", product)
    assert _widget((await client.get("/api/v1/dashboard", headers=owner)).json(), "open_bills")["count"] == 1
    other = (await client.get("/api/v1/dashboard", headers=tenant_b["headers"])).json()
    assert "Secret Biryani" not in str(other)
    assert all(b.get("table_label") != "S1" for w in other["widgets"] for b in (w.get("data") or {}).get("bills", []))


@pytest.mark.asyncio
async def test_dashboard_works_when_redis_is_down_or_slow(client, fresh_tenant, monkeypatch):
    owner = fresh_tenant["headers"]

    async def broken():
        raise ConnectionError("redis is down")

    async def slow():
        await asyncio.sleep(5)

    dashboard_cache.reset_for_tests()
    monkeypatch.setattr(dashboard_cache, "get_redis_client", broken)
    resp = await client.get("/api/v1/dashboard", headers=owner)
    assert resp.status_code == 200 and resp.json()["widgets"] and all("error" not in w for w in resp.json()["widgets"])

    dashboard_cache.reset_for_tests()
    monkeypatch.setattr(dashboard_cache, "get_redis_client", slow)
    started = time.monotonic()
    resp = await client.get("/api/v1/dashboard", headers=owner)
    assert resp.status_code == 200 and all("error" not in w for w in resp.json()["widgets"])
    assert time.monotonic() - started < 3  # one short Redis wait at most, then the local cache
    dashboard_cache.reset_for_tests()


@pytest.mark.asyncio
async def test_voids_and_comps_counts_for_managers_amounts_for_the_owner(client, fresh_tenant):
    owner = fresh_tenant["headers"]
    manager = await create_staff(client, owner, "manager")
    product = await create_product(client, owner, "Lassi", 80, tax_rate=0)
    order = (await client.post("/api/v1/orders", headers=owner, json={"items": [{"product_id": product["id"], "quantity": 1}],
                                                                       "order_type": "TAKEAWAY"})).json()
    resp = await client.post(f"/api/v1/orders/{order['id']}/cancel", headers=owner, json={"reason": "Customer left"})
    assert resp.status_code == 200, resp.text

    mine = _widget((await client.get("/api/v1/dashboard", headers=owner)).json(), "voids_comps")
    assert mine["cancelled_bills"] == 1 and mine["cancelled_bills_value"] == order["total_amount"]
    watch = (await client.get("/api/v1/owner/watch", headers=owner)).json()["totals"]
    assert mine["cancelled_bills"] == watch["cancelled_bills"]  # same rules as the Owner's watch

    theirs = _widget((await client.get("/api/v1/dashboard", headers=manager["headers"])).json(), "voids_comps")
    assert theirs["cancelled_bills"] == 1
    assert not [k for k in theirs if k.endswith("_value")]


@pytest.mark.asyncio
async def test_plan_override_moves_insights_into_the_owners_locked_card(client, fresh_tenant, platform_admin):
    owner = fresh_tenant["headers"]
    tenant_id = fresh_tenant["tenant_id"]
    resp = await client.put(f"/api/v1/platform/businesses/{tenant_id}", headers=platform_admin,
                            json={"feature_overrides": {"dashboard_insights": False}})
    assert resp.status_code == 200, resp.text
    body = (await client.get("/api/v1/dashboard", headers=owner)).json()
    assert body["locked"] == INSIGHT_KEYS
    assert not set(INSIGHT_KEYS) & {w["key"] for w in body["widgets"]}
    assert "floor_live" in {w["key"] for w in body["widgets"]}


@pytest.mark.asyncio
async def test_local_cache_serves_repeat_calls_while_redis_is_down(monkeypatch):
    async def broken():
        raise ConnectionError("redis is down")

    calls = []

    async def compute():
        calls.append(1)
        return {"n": len(calls)}

    dashboard_cache.reset_for_tests()
    monkeypatch.setattr(dashboard_cache, "get_redis_client", broken)
    assert await dashboard_cache.get_or_compute("test-tenant:x:20261124", 30, compute) == {"n": 1}
    assert await dashboard_cache.get_or_compute("test-tenant:x:20261124", 30, compute) == {"n": 1}  # local cache
    assert len(calls) == 1
    assert await dashboard_cache.get_or_compute("test-tenant:y:20261124", 0, compute) == {"n": 2}  # ttl 0: never cached
    dashboard_cache.reset_for_tests()
