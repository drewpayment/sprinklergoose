"""M1 W2: zone-enablement enforcement against a fake DB layer (M1.E1–E4).

Covers the DATABASE_URL-configured executor: 403 on disabled zones, `enabled`
in status with a ≤5s cache, and fail-safe behavior when the DB is down
(starts refused 503, status served from the last cache — never water on
unknown config). The no-DB path (M1.E2) is the entire pre-existing suite plus
the explicit back-compat tests at the bottom.
"""

import asyncio

import httpx
import pytest

from app.main import (
    DETAIL_UNKNOWN_ZONE,
    DETAIL_ZONE_CONFIG_UNAVAILABLE,
    DETAIL_ZONE_DISABLED,
    create_app,
)
from app.zone_config import (
    CACHE_TTL_SECONDS,
    ZoneConfigUnavailableError,
    ZoneEnablement,
)

# Matches the M1 seed: zones 1–5 enabled, 6–7 disabled (unwired).
SEED = {1: True, 2: True, 3: True, 4: True, 5: True, 6: False, 7: False}


class FakeZoneConfigSource:
    """In-memory stand-in for the Postgres `zones` table."""

    def __init__(self, enabled: dict[int, bool]) -> None:
        self.enabled = dict(enabled)
        self.unavailable = False
        self.fetch_count = 0
        self.closed = False

    async def fetch_enabled(self) -> dict[int, bool]:
        self.fetch_count += 1
        if self.unavailable:
            raise ZoneConfigUnavailableError("connection refused")
        return dict(self.enabled)

    async def close(self) -> None:
        self.closed = True


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def zone_source() -> FakeZoneConfigSource:
    return FakeZoneConfigSource(SEED)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def enablement(zone_source, clock) -> ZoneEnablement:
    return ZoneEnablement(zone_source, ttl=CACHE_TTL_SECONDS, clock=clock)


@pytest.fixture
async def db_client(settings, service, enablement):
    """Client against an app configured with the (fake) zones table."""
    app = create_app(settings=settings, service=service, zone_enablement=enablement)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# ------------------------------------------------------- M1.E1: 403 disabled


async def test_start_disabled_zone_403_and_never_touches_module(
    db_client, fake_controller
):
    resp = await db_client.post("/api/zones/6/start", json={"minutes": 5})
    assert resp.status_code == 403
    assert resp.json()["detail"] == DETAIL_ZONE_DISABLED
    assert fake_controller.call_count("irrigate_zone") == 0
    assert fake_controller.active_zones == set()


async def test_start_enabled_zone_still_works(db_client, fake_controller):
    resp = await db_client.post("/api/zones/3/start", json={"minutes": 10})
    assert resp.status_code == 200
    assert resp.json() == {"active_zones": [3]}
    assert fake_controller.active_zones == {3}


async def test_zone_missing_from_table_is_unknown_config_403(
    db_client, zone_source, fake_controller
):
    """A controller station with no row has unknown config — never waters."""
    del zone_source.enabled[5]
    resp = await db_client.post("/api/zones/5/start", json={"minutes": 5})
    assert resp.status_code == 403
    assert resp.json()["detail"] == DETAIL_ZONE_DISABLED
    assert fake_controller.call_count("irrigate_zone") == 0


async def test_unknown_zone_id_still_404_with_db(db_client):
    resp = await db_client.post("/api/zones/8/start", json={"minutes": 5})
    assert resp.status_code == 404
    assert resp.json()["detail"] == DETAIL_UNKNOWN_ZONE


async def test_start_when_controller_unreachable_still_503_with_db(
    db_client, fake_controller
):
    fake_controller.unreachable = True
    resp = await db_client.post("/api/zones/1/start", json={"minutes": 5})
    assert resp.status_code == 503
    assert resp.json()["detail"] == "controller unreachable"


# --------------------------------------- M1.E3: enabled in status, ≤5s cache


async def test_status_includes_accurate_enabled(db_client):
    body = (await db_client.get("/api/status")).json()
    assert {z["id"]: z["enabled"] for z in body["zones"]} == SEED


async def test_enabled_flip_visible_after_ttl_but_cached_within(
    db_client, zone_source, clock
):
    body = (await db_client.get("/api/status")).json()
    assert body["zones"][0]["enabled"] is True

    zone_source.enabled[1] = False  # admin disables zone 1 in the DB

    clock.advance(CACHE_TTL_SECONDS - 0.5)  # still within the cache window
    body = (await db_client.get("/api/status")).json()
    assert body["zones"][0]["enabled"] is True
    assert zone_source.fetch_count == 1  # served from cache — one DB read total

    clock.advance(1.0)  # now past the 5s TTL
    body = (await db_client.get("/api/status")).json()
    assert body["zones"][0]["enabled"] is False
    assert zone_source.fetch_count == 2


async def test_start_gate_sees_db_change_after_ttl(db_client, zone_source, clock):
    assert (
        await db_client.post("/api/zones/2/start", json={"minutes": 5})
    ).status_code == 200

    zone_source.enabled[2] = False
    clock.advance(CACHE_TTL_SECONDS + 0.1)

    resp = await db_client.post("/api/zones/2/start", json={"minutes": 5})
    assert resp.status_code == 403


async def test_concurrent_status_requests_share_one_db_read(db_client, zone_source):
    responses = await asyncio.gather(*(db_client.get("/api/status") for _ in range(5)))
    assert all(r.status_code == 200 for r in responses)
    assert zone_source.fetch_count == 1


# ----------------------------------------------------- M1.E4: DB unreachable


async def test_db_down_start_refused_503(db_client, zone_source, fake_controller):
    zone_source.unavailable = True
    resp = await db_client.post("/api/zones/1/start", json={"minutes": 5})
    assert resp.status_code == 503
    assert resp.json()["detail"] == DETAIL_ZONE_CONFIG_UNAVAILABLE
    assert fake_controller.call_count("irrigate_zone") == 0


async def test_db_down_after_cache_expiry_start_refused_503(
    db_client, zone_source, clock, fake_controller
):
    """An enabled zone stops being startable once the cache goes stale."""
    assert (
        await db_client.post("/api/zones/1/start", json={"minutes": 5})
    ).status_code == 200
    await db_client.post("/api/zones/stop")
    irrigations = fake_controller.call_count("irrigate_zone")

    zone_source.unavailable = True
    clock.advance(CACHE_TTL_SECONDS + 0.1)

    resp = await db_client.post("/api/zones/1/start", json={"minutes": 5})
    assert resp.status_code == 503
    assert resp.json()["detail"] == DETAIL_ZONE_CONFIG_UNAVAILABLE
    assert fake_controller.call_count("irrigate_zone") == irrigations


async def test_db_down_within_ttl_start_uses_fresh_cache(db_client, zone_source):
    """Within the ≤5s window the last read is authoritative by contract."""
    await db_client.get("/api/status")  # primes the cache
    zone_source.unavailable = True
    resp = await db_client.post("/api/zones/1/start", json={"minutes": 5})
    assert resp.status_code == 200


async def test_db_down_status_served_from_last_cache(db_client, zone_source, clock):
    await db_client.get("/api/status")  # primes the cache

    zone_source.unavailable = True
    clock.advance(CACHE_TTL_SECONDS + 10)  # cache long stale

    resp = await db_client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert {z["id"]: z["enabled"] for z in body["zones"]} == SEED


async def test_db_down_before_first_read_status_still_served(db_client, zone_source):
    """No cache to fall back on: status still works, enabled defaults true
    (starts are independently refused with 503, so this cannot water)."""
    zone_source.unavailable = True
    resp = await db_client.get("/api/status")
    assert resp.status_code == 200
    assert all(z["enabled"] is True for z in resp.json()["zones"])


async def test_db_recovers_after_outage(db_client, zone_source, clock):
    await db_client.get("/api/status")
    zone_source.unavailable = True
    clock.advance(CACHE_TTL_SECONDS + 1)
    assert (
        await db_client.post("/api/zones/1/start", json={"minutes": 5})
    ).status_code == 503

    zone_source.unavailable = False
    resp = await db_client.post("/api/zones/1/start", json={"minutes": 5})
    assert resp.status_code == 200


# --------------------------------------------- M1.E2: no DATABASE_URL (v1)


async def test_no_db_status_enabled_true_for_all(client):
    """`client` is the v1 fixture — no zone enablement configured."""
    body = (await client.get("/api/status")).json()
    assert [z["enabled"] for z in body["zones"]] == [True] * 7


async def test_no_db_can_start_any_known_zone(client, fake_controller):
    for zone_id in (6, 7):  # disabled in the seed, but there is no DB here
        resp = await client.post(f"/api/zones/{zone_id}/start", json={"minutes": 5})
        assert resp.status_code == 200
