"""Indian mobile numbers on sign-up and sign-in (app/core/phone.py): 10 digits, starting 6-9; +91 / 91 / 0 forms accepted;
existing accounts keep signing in whatever form their number was stored in."""
import uuid
import pytest
from sqlalchemy import update
from app.core.phone import looks_like_phone, normalize_indian_mobile
from app.core.tenant import get_shared_session_maker
from app.models import GlobalUser
from tests.conftest import random_client_ip


def test_normalising_rules():
    assert normalize_indian_mobile("9876543210") == "9876543210"
    assert normalize_indian_mobile("98765 43210") == "9876543210"
    assert normalize_indian_mobile("(98765)-43210") == "9876543210"
    assert normalize_indian_mobile("+91 98765 43210") == "9876543210"
    assert normalize_indian_mobile("919876543210") == "9876543210"
    assert normalize_indian_mobile("09876543210") == "9876543210"
    assert normalize_indian_mobile("9198765432") == "9198765432"  # a real number that starts 91 is never shortened
    assert normalize_indian_mobile("5876543210") is None  # first digit 0-5
    assert normalize_indian_mobile("987654321") is None  # 9 digits
    assert normalize_indian_mobile("98765432101") is None  # 11 digits, not a leading 0
    assert normalize_indian_mobile("+1 9876543210") is None  # another country
    assert normalize_indian_mobile("") is None and normalize_indian_mobile(None) is None
    assert looks_like_phone("+91 98765 43210") and looks_like_phone("9876543210")
    assert not looks_like_phone("owner@example.com") and not looks_like_phone("ravi")


def _mobile() -> str:
    return "9" + str(uuid.uuid4().int)[:9]


async def _register(client, phone: str):
    email = f"mob_{uuid.uuid4().hex[:10]}@example.com"
    resp = await client.post("/api/v1/auth/register", headers=random_client_ip(), json={
        "vendor_name": "Mobile Test", "owner_name": "Owner", "email": email, "phone": phone, "password": "securepassword"})
    return resp, email


async def _login(client, identifier: str, password: str = "securepassword"):
    return await client.post("/api/v1/auth/login", headers=random_client_ip(), json={"email": identifier, "password": password})


@pytest.mark.asyncio
async def test_signup_accepts_indian_mobiles_only(client):
    for bad in ("5123456789", "98765432", "987654321012", "+1 2025550123", "98765-4321x"):
        resp, _ = await _register(client, bad)
        assert resp.status_code == 422, (bad, resp.text)
        assert resp.json()["error"]["code"] == "INVALID_INDIAN_MOBILE"
        assert resp.json()["error"]["message"] == "Enter a valid 10-digit Indian mobile number"

    # +91 form: stored as the plain 10-digit number, so either form signs in
    mobile = _mobile()
    resp, email = await _register(client, f"+91 {mobile[:5]} {mobile[5:]}")
    assert resp.status_code == 200, resp.text
    async with get_shared_session_maker()() as db:
        stored = (await db.execute(GlobalUser.__table__.select().where(GlobalUser.email == email))).first()
    assert stored.phone == mobile
    for identifier in (mobile, f"+91{mobile}", f"0{mobile}", f"{mobile[:5]} {mobile[5:]}"):
        assert (await _login(client, identifier)).status_code == 200, identifier

    # The same number in another form is still the same account
    resp, _ = await _register(client, f"0{mobile}")
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_login_with_a_bad_number_says_so(client):
    for bad in ("12345", "5123456789", "98765432101"):
        resp = await _login(client, bad)
        assert resp.status_code == 422 and resp.json()["error"]["code"] == "INVALID_INDIAN_MOBILE", bad
    # A valid number with no account: the usual wrong-login answer
    assert (await _login(client, _mobile())).status_code == 401
    # Wrong password on a real account
    mobile = _mobile()
    await _register(client, mobile)
    assert (await _login(client, mobile, "wrongpassword")).status_code == 401


@pytest.mark.asyncio
async def test_existing_accounts_keep_signing_in(client):
    # Demo users have numbers like 9800000001: they fit the rule
    demo_like = "98" + str(uuid.uuid4().int)[:8]
    resp, email = await _register(client, demo_like)
    assert resp.status_code == 200
    assert (await _login(client, demo_like)).status_code == 200
    assert (await _login(client, email)).status_code == 200

    # An older account stored its number as "+91…": the 10 digits find it
    mobile = _mobile()
    _, email_old = await _register(client, mobile)
    async with get_shared_session_maker()() as db:
        await db.execute(update(GlobalUser).where(GlobalUser.email == email_old).values(phone=f"+91{mobile}"))
        await db.commit()
    assert (await _login(client, mobile)).status_code == 200
    assert (await _login(client, f"+91 {mobile}")).status_code == 200

    # An older account whose number doesn't fit the rule (e.g. a landline) still signs in with exactly that, or its email
    _, email_landline = await _register(client, _mobile())
    landline = "044" + str(uuid.uuid4().int)[:8]  # Chennai landline: 0 + "44…" is not a mobile
    async with get_shared_session_maker()() as db:
        await db.execute(update(GlobalUser).where(GlobalUser.email == email_landline).values(phone=landline))
        await db.commit()
    assert (await _login(client, landline)).status_code == 200
    assert (await _login(client, email_landline)).status_code == 200
