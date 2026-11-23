"""Indian mobile numbers for sign-up and sign-in: exactly 10 digits, starting with 6, 7, 8 or 9.

Same rule as the app (frontend/src/lib/phone.ts). Only sign-up and the login lookup use it; business, customer and receipt
phone fields keep accepting landlines.

Normalising (what a person may type or paste):
- spaces, dashes, dots and brackets are ignored;
- a leading +91 / 91 is dropped only when that leaves exactly 10 digits (12 digits in all);
- a single leading 0 is dropped only when there are 11 digits;
so a real number such as 9198765432 is never shortened.
"""
import re
from fastapi import HTTPException

INDIAN_MOBILE = re.compile(r"^[6-9]\d{9}$")
_SEPARATORS = re.compile(r"[\s\-().]")
INVALID_MESSAGE = "Enter a valid 10-digit Indian mobile number"


def normalize_indian_mobile(raw: str | None) -> str | None:
    """The 10-digit number, or None when it isn't a valid Indian mobile number."""
    text = _SEPARATORS.sub("", raw or "")
    if text.startswith("+"):
        if not text.startswith("+91"):
            return None
        text = text[1:]  # "+91…": the 91 is handled with the digits below
    if not text.isdigit():
        return None
    if len(text) == 12 and text.startswith("91"):
        text = text[2:]
    elif len(text) == 11 and text.startswith("0"):
        text = text[1:]
    return text if INDIAN_MOBILE.match(text) else None


def looks_like_phone(identifier: str) -> bool:
    """A login identifier that is meant as a phone number (no @, no letters)."""
    text = _SEPARATORS.sub("", identifier or "")
    return bool(text) and "@" not in text and bool(re.fullmatch(r"\+?\d+", text))


def stored_forms(mobile: str) -> list[str]:
    """How a 10-digit number may already be stored on older accounts (as typed, spaces removed)."""
    return [mobile, f"+91{mobile}", f"91{mobile}", f"0{mobile}"]


def invalid_mobile_error() -> HTTPException:
    return HTTPException(status_code=422, detail={"code": "INVALID_INDIAN_MOBILE", "message": INVALID_MESSAGE, "details": {}})
