"""Endpoint behavior tests against the fake controller."""

from app.main import create_app
from app.rainbird import RainbirdService
from app.zone_names import ZoneNameStore

import httpx


# ------------------------------------------------------------------- healthz


async def test_healthz_ok_and_never_touches_module(client, fake_controller):
    fake_controller.unreachable = True  # would blow up if the module were hit
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
    assert fake_controller.calls == []


# -------------------------------------------------------------------- status


async def test_status_full_shape(client):
    resp = await client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["controller"] == {
        "model": "ESP-Me",
        "firmware": "2.9",
        "serial": "4769753604227727360",
    }
    assert body["reachable"] is True
    assert body["rain_sensor_active"] is False
    assert body["rain_delay_days"] == 0
    assert [z["id"] for z in body["zones"]] == [1, 2, 3, 4, 5, 6, 7]
    assert body["zones"][0] == {
        "id": 1,
        "name": "Zone 1",
        "active": False,
        "remaining_seconds": None,
        "enabled": True,  # no DATABASE_URL configured → always true (M1.E2)
    }


async def test_status_caches_static_info(client, fake_controller):
    await client.get("/api/status")
    await client.get("/api/status")
    assert fake_controller.call_count("get_model_and_version") == 1
    assert fake_controller.call_count("get_serial_number") == 1
    assert fake_controller.call_count("get_available_stations") == 1
    assert fake_controller.call_count("get_zone_states") == 2


async def test_status_zone_started_by_dial_has_null_remaining(client, fake_controller):
    fake_controller.active_zones = {2}  # not started through the API
    body = (await client.get("/api/status")).json()
    zone2 = body["zones"][1]
    assert zone2["active"] is True
    assert zone2["remaining_seconds"] is None


# ------------------------------------------------------------ zone start/stop


async def test_start_zone_flow(client, fake_controller, service):
    resp = await client.post("/api/zones/3/start", json={"minutes": 10})
    assert resp.status_code == 200
    assert resp.json() == {"active_zones": [3]}
    assert fake_controller.active_zones == {3}

    body = (await client.get("/api/status")).json()
    zone3 = body["zones"][2]
    assert zone3["active"] is True
    assert 595 <= zone3["remaining_seconds"] <= 600


async def test_remaining_seconds_counts_down(client, service):
    await client.post("/api/zones/3/start", json={"minutes": 10})
    service._runs[3].started_at -= 100  # simulate 100s elapsed
    body = (await client.get("/api/status")).json()
    assert 495 <= body["zones"][2]["remaining_seconds"] <= 500


async def test_remaining_seconds_clamps_at_zero(client, service):
    await client.post("/api/zones/3/start", json={"minutes": 1})
    service._runs[3].started_at -= 3600  # long past requested duration
    body = (await client.get("/api/status")).json()
    assert body["zones"][2]["remaining_seconds"] == 0


async def test_start_second_zone_switches(client, fake_controller):
    await client.post("/api/zones/1/start", json={"minutes": 5})
    resp = await client.post("/api/zones/2/start", json={"minutes": 5})
    assert resp.json() == {"active_zones": [2]}
    body = (await client.get("/api/status")).json()
    assert body["zones"][0]["active"] is False
    assert body["zones"][0]["remaining_seconds"] is None
    assert body["zones"][1]["active"] is True


async def test_stop_all(client, fake_controller):
    await client.post("/api/zones/4/start", json={"minutes": 15})
    resp = await client.post("/api/zones/stop")
    assert resp.status_code == 200
    assert resp.json() == {"active_zones": []}
    assert fake_controller.active_zones == set()
    body = (await client.get("/api/status")).json()
    assert all(z["active"] is False for z in body["zones"])
    assert all(z["remaining_seconds"] is None for z in body["zones"])


async def test_start_unknown_zone_404(client):
    resp = await client.post("/api/zones/8/start", json={"minutes": 5})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "unknown zone"


async def test_start_validation_422(client):
    for minutes in (0, 241, "ten", None):
        resp = await client.post("/api/zones/1/start", json={"minutes": minutes})
        assert resp.status_code == 422, f"minutes={minutes}"
    resp = await client.post("/api/zones/1/start", json={})
    assert resp.status_code == 422


# ------------------------------------- run tracking: module lag / grace period


def _lag_irrigate(fake_controller):
    """Make irrigate_zone succeed WITHOUT updating the active set — the real
    ESP-Me can report the zone inactive for a poll or two after starting."""

    async def irrigate_zone(zone: int, minutes: int) -> None:
        await fake_controller._do("irrigate_zone")

    fake_controller.irrigate_zone = irrigate_zone


async def test_module_lag_keeps_run_during_startup_grace(client, fake_controller):
    _lag_irrigate(fake_controller)
    resp = await client.post("/api/zones/3/start", json={"minutes": 10})
    assert resp.status_code == 200
    assert resp.json() == {"active_zones": []}  # module lag: not active yet

    # First poll: still not reported active — run must survive (grace).
    body = (await client.get("/api/status")).json()
    zone3 = body["zones"][2]
    assert zone3["active"] is False
    first = zone3["remaining_seconds"]
    assert first is not None
    assert 595 <= first <= 600

    # Module catches up: second poll reports active, countdown continues.
    fake_controller.active_zones = {3}
    body = (await client.get("/api/status")).json()
    zone3 = body["zones"][2]
    assert zone3["active"] is True
    second = zone3["remaining_seconds"]
    assert second is not None
    assert second <= first

    # Once observed active, normal eviction applies again.
    fake_controller.active_zones = set()
    body = (await client.get("/api/status")).json()
    assert body["zones"][2]["active"] is False
    assert body["zones"][2]["remaining_seconds"] is None


async def test_run_never_observed_active_evicted_after_grace(
    client, fake_controller, service
):
    _lag_irrigate(fake_controller)
    await client.post("/api/zones/3/start", json={"minutes": 10})
    service._runs[3].started_at -= 20  # older than the 15s startup grace

    body = (await client.get("/api/status")).json()
    assert body["zones"][2]["remaining_seconds"] is None  # evicted

    # Even if the zone shows up active later, the run is gone → dial semantics.
    fake_controller.active_zones = {3}
    body = (await client.get("/api/status")).json()
    assert body["zones"][2]["active"] is True
    assert body["zones"][2]["remaining_seconds"] is None


async def test_stale_run_hard_expires_past_duration_plus_slack(
    client, fake_controller, service
):
    _lag_irrigate(fake_controller)
    await client.post("/api/zones/3/start", json={"minutes": 1})
    # Way past duration (60s) + 60s slack without ever being observed active.
    service._runs[3].started_at -= 200

    # Zone now reports active — but this cannot be *our* run anymore.
    fake_controller.active_zones = {3}
    body = (await client.get("/api/status")).json()
    assert body["zones"][2]["active"] is True
    assert body["zones"][2]["remaining_seconds"] is None
    assert 3 not in service._runs


async def test_grace_run_evicted_when_another_zone_takes_over(
    client, fake_controller, service
):
    _lag_irrigate(fake_controller)
    await client.post("/api/zones/3/start", json={"minutes": 10})
    # A different zone is running (dial switch) — grace does not protect.
    fake_controller.active_zones = {5}
    body = (await client.get("/api/status")).json()
    assert body["zones"][2]["remaining_seconds"] is None
    assert 3 not in service._runs


# ------------------------------------------------------------------ renaming


async def test_rename_zone(client):
    resp = await client.patch("/api/zones/2", json={"name": "Back lawn"})
    assert resp.status_code == 200
    assert resp.json() == {
        "id": 2,
        "name": "Back lawn",
        "active": False,
        "remaining_seconds": None,
        "enabled": True,
    }
    body = (await client.get("/api/status")).json()
    assert body["zones"][1]["name"] == "Back lawn"


async def test_rename_persists_across_restart(
    client, settings, zone_names_file, fake_controller
):
    await client.patch("/api/zones/5", json={"name": "Front beds"})

    # Simulate a backend restart: fresh store + service reading the same file.
    service2 = RainbirdService(
        host=settings.rainbird_host,
        password=settings.rainbird_password,
        zone_names=ZoneNameStore(zone_names_file),
        controller_factory=lambda: fake_controller,
    )
    app2 = create_app(settings=settings, service=service2)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app2), base_url="http://test"
    ) as client2:
        body = (await client2.get("/api/status")).json()
    assert body["zones"][4]["name"] == "Front beds"


async def test_rename_validation_422(client):
    assert (await client.patch("/api/zones/1", json={"name": ""})).status_code == 422
    assert (
        await client.patch("/api/zones/1", json={"name": "x" * 41})
    ).status_code == 422
    assert (await client.patch("/api/zones/1", json={})).status_code == 422


async def test_rename_unknown_zone_404(client):
    resp = await client.patch("/api/zones/99", json={"name": "Nope"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "unknown zone"


# ---------------------------------------------------------------- rain delay


async def test_rain_delay_get_and_set(client, fake_controller):
    assert (await client.get("/api/rain-delay")).json() == {"days": 0}

    resp = await client.put("/api/rain-delay", json={"days": 2})
    assert resp.status_code == 200
    assert resp.json() == {"days": 2}
    assert fake_controller.rain_delay == 2

    assert (await client.get("/api/rain-delay")).json() == {"days": 2}

    resp = await client.put("/api/rain-delay", json={"days": 0})
    assert resp.json() == {"days": 0}
    assert fake_controller.rain_delay == 0


async def test_rain_delay_validation_422(client):
    for days in (-1, 15, "two"):
        resp = await client.put("/api/rain-delay", json={"days": days})
        assert resp.status_code == 422, f"days={days}"


# --------------------------------------------------------------- unreachable


async def test_unreachable_maps_to_503(client, fake_controller):
    fake_controller.unreachable = True
    for method, url, kwargs in [
        ("GET", "/api/status", {}),
        ("POST", "/api/zones/1/start", {"json": {"minutes": 5}}),
        ("POST", "/api/zones/stop", {}),
        ("GET", "/api/rain-delay", {}),
        ("PUT", "/api/rain-delay", {"json": {"days": 1}}),
        ("PATCH", "/api/zones/1", {"json": {"name": "X"}}),
    ]:
        resp = await client.request(method, url, **kwargs)
        assert resp.status_code == 503, f"{method} {url}"
        assert resp.json()["detail"] == "controller unreachable"


async def test_status_serves_cache_when_unreachable(client, fake_controller):
    fake_controller.active_zones = {1}
    first = (await client.get("/api/status")).json()
    assert first["reachable"] is True

    fake_controller.unreachable = True
    resp = await client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["reachable"] is False
    assert body["cached_at"] is not None
    assert body["zones"][0]["active"] is True  # as of cached_at
    assert body["controller"]["model"] == "ESP-Me"


async def test_zone_start_never_queued_silently(client, fake_controller):
    """N2: commands against an unreachable module error out, never queue."""
    fake_controller.unreachable = True
    resp = await client.post("/api/zones/1/start", json={"minutes": 5})
    assert resp.status_code == 503

    fake_controller.unreachable = False
    body = (await client.get("/api/status")).json()
    assert all(z["active"] is False for z in body["zones"])
