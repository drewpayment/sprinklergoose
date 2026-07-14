"""M4.M: GET /api/forecast wired through the API (docs/M4-MAP-SPEC.md E1).

Mirrors test_scheduler_api.py's pattern: a real Scheduler + fake store/clock
wired into create_app via ASGITransport, ticked manually.
"""

from datetime import timedelta

import httpx
import pytest

from app.main import create_app
from app.scheduler import Scheduler
from app.weather import HourlyBucket, WeatherSnapshot

from .scheduler_testkit import (
    FakeClock,
    FakeSchedulerStore,
    FakeWeatherSource,
    local,
    make_program,
    make_weather_settings,
)


@pytest.fixture
def sched_store() -> FakeSchedulerStore:
    return FakeSchedulerStore()


@pytest.fixture
def sched_clock() -> FakeClock:
    return FakeClock(local(5, 59, 58))


@pytest.fixture
def source() -> FakeWeatherSource:
    return FakeWeatherSource()


@pytest.fixture
def scheduler(sched_store, service, sched_clock, source) -> Scheduler:
    return Scheduler(
        store=sched_store,
        service=service,
        clock=sched_clock,
        timezone="America/Detroit",
        weather_source=source,
        lookback=timedelta(hours=2),
    )


@pytest.fixture
async def sched_client(settings, service, scheduler):
    app = create_app(settings=settings, service=service, scheduler=scheduler)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


# --------------------------------------------------------------- E1: shape


async def test_forecast_no_scheduler_never_500s(client):
    """The v1-shaped app (no DATABASE_URL): no scheduler, no weather —
    the endpoint degrades cleanly instead of 500ing."""
    resp = await client.get("/api/forecast")
    assert resp.status_code == 200
    assert resp.json() == {"enabled": False, "weather": None, "hourly": [], "upcoming": []}


async def test_forecast_full_shape(sched_client, sched_store, scheduler, sched_clock):
    sched_store.weather_settings = make_weather_settings(
        rain_lookback_mm=6.0, forecast_lookahead_mm=4.0, freeze_temp_c=1.0
    )
    sched_store.programs = [make_program(program_id=3, name="Lawn", times=("06:00",))]
    await scheduler.tick()  # loads programs/settings; 05:59:58 — nothing fires yet

    now = sched_clock.now()
    scheduler.weather.snapshot = WeatherSnapshot(
        fetched_at=now,
        past24_mm=1.2,
        next6_mm=0.0,
        current_temp_c=21.4,
        hourly=(HourlyBucket(time=now, precip_mm=0.2, temp_c=21.4),),
    )

    resp = await sched_client.get("/api/forecast")
    assert resp.status_code == 200
    body = resp.json()

    assert body["enabled"] is True
    assert body["weather"] == {
        "fetched_at": now.isoformat(),
        "past24_mm": 1.2,
        "next6_mm": 0.0,
        "current_temp_c": 21.4,
    }
    assert body["hourly"] == [
        {"time": now.isoformat(), "precip_mm": 0.2, "temp_c": 21.4}
    ]
    # Daily program: today's and tomorrow's 06:00 both fall in the 48h
    # window; only the first (today's, using the hourly bucket we set) is
    # asserted in full — the rest is covered by test_build_forecast_* above.
    assert body["upcoming"][0] == {
        "program_id": 3,
        "program_name": "Lawn",
        "at": local(6, 0).isoformat(),
        "prediction": "watering",
        "note": None,
    }
    assert len(body["upcoming"]) == 2


async def test_forecast_weather_disabled_gives_null_weather_and_unknown_predictions(
    sched_client, sched_store, scheduler, sched_clock
):
    sched_store.weather_settings = make_weather_settings(enabled=False)
    sched_store.programs = [make_program(program_id=1, name="Lawn", times=("06:00",))]
    await scheduler.tick()

    resp = await sched_client.get("/api/forecast")
    body = resp.json()
    assert body["enabled"] is False
    assert body["weather"] is None
    assert body["hourly"] == []
    assert body["upcoming"][0]["prediction"] == "unknown"
    assert body["upcoming"][0]["note"] == "no weather data"


async def test_forecast_respects_program_enablement(
    sched_client, sched_store, scheduler
):
    sched_store.programs = [
        make_program(program_id=1, name="Off", times=("07:00",), enabled=False)
    ]
    await scheduler.tick()
    body = (await sched_client.get("/api/forecast")).json()
    assert body["upcoming"] == []


async def test_forecast_ignores_rain_delay_prediction_shape(
    sched_client, sched_store, scheduler
):
    sched_store.programs = [
        make_program(
            program_id=1, name="Patio", times=("06:00",), respect_rain_delay=False
        )
    ]
    await scheduler.tick()
    body = (await sched_client.get("/api/forecast")).json()
    assert body["upcoming"][0] == {
        "program_id": 1,
        "program_name": "Patio",
        "at": local(6, 0).isoformat(),
        "prediction": "watering",
        "note": "ignores rain delay and weather",
    }
