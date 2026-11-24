"""Short-lived cache for Home dashboard widgets, so many devices of one shop don't repeat the same queries.

Redis first (shared by every API worker). When Redis is down or slow, a small in-process cache takes over for a while.
The cache can never fail or hold up a request: any problem with it means "work it out now".
Values must be JSON-serialisable (they are what the API returns).
"""
import asyncio
import json
import logging
import time
from typing import Any, Awaitable, Callable
from app.core.tenant import get_redis_client

logger = logging.getLogger("tallyko")

REDIS_TIMEOUT = 0.25      # seconds; a slower Redis counts as down
REDIS_RETRY_AFTER = 30.0  # seconds to stay on the local cache after a Redis problem
LOCAL_MAX = 2000          # entries kept in this process
PREFIX = "dash:v1:"

_MISS = object()
_local: dict[str, tuple[float, Any]] = {}
_redis_down_until = 0.0


def _local_get(key: str) -> Any:
    hit = _local.get(key)
    if hit is None:
        return _MISS
    if hit[0] <= time.monotonic():
        _local.pop(key, None)
        return _MISS
    return hit[1]


def _local_set(key: str, ttl: int, value: Any) -> None:
    now = time.monotonic()
    if len(_local) >= LOCAL_MAX:
        for k in [k for k, (until, _) in _local.items() if until <= now]:
            _local.pop(k, None)
        while len(_local) >= LOCAL_MAX:  # still full: drop the entries that expire first
            _local.pop(min(_local, key=lambda k: _local[k][0]), None)
    _local[key] = (now + ttl, value)


def _redis_usable() -> bool:
    return time.monotonic() >= _redis_down_until


def _mark_redis_down(exc: BaseException) -> None:
    global _redis_down_until
    if _redis_usable():
        logger.warning(f"[Dashboard] Redis cache unavailable, using the local cache for {int(REDIS_RETRY_AFTER)}s: {exc!r}")
    _redis_down_until = time.monotonic() + REDIS_RETRY_AFTER


async def get_or_compute(key: str, ttl: int, compute: Callable[[], Awaitable[Any]]) -> Any:
    """The cached value for `key`, or `compute()` (then cached for `ttl` seconds). Never raises because of the cache."""
    if ttl <= 0:
        return await compute()
    redis = None
    if _redis_usable():
        try:
            redis = await asyncio.wait_for(get_redis_client(), REDIS_TIMEOUT)
            raw = await asyncio.wait_for(redis.get(PREFIX + key), REDIS_TIMEOUT)
            if raw is not None:
                return json.loads(raw)
        except Exception as exc:  # down, slow, or a bad value: carry on without Redis
            _mark_redis_down(exc)
            redis = None
    else:
        cached = _local_get(key)
        if cached is not _MISS:
            return cached

    value = await compute()

    if redis is not None:
        try:
            await asyncio.wait_for(redis.set(PREFIX + key, json.dumps(value), ex=ttl), REDIS_TIMEOUT)
        except Exception as exc:
            _mark_redis_down(exc)
            _local_set(key, ttl, value)
    else:
        _local_set(key, ttl, value)
    return value


def reset_for_tests() -> None:
    """Forget local entries and any Redis outage (tests only)."""
    global _redis_down_until
    _local.clear()
    _redis_down_until = 0.0
