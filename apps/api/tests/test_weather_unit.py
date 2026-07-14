"""M3 W1 unit tests: weather-skip semantics (M3.E1–E6) with a fake weather
source and the fake clock — no network, no database, no real time.

Layout mirrors test_scheduler_unit.py: every test drives Scheduler.tick()
directly. The default program (make_program) runs daily at 06:00 and the
clock starts at 05:59:58.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app.scheduler import Scheduler
from app.weather import parse_open_meteo

from .scheduler_testkit import (
    FakeClock,
    FakeIrrigation,
    FakeSchedulerStore,
    FakeWeatherSource,
    drain,
    local,
    make_program,
    make_weather_settings,
)


@pytest.fixture
def store() -> FakeSchedulerStore:
    return FakeSchedulerStore()


@pytest.fixture
def irrigation() -> FakeIrrigation:
    return FakeIrrigation()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(local(5, 59, 58))


@pytest.fixture
def source() -> FakeWeatherSource:
    return FakeWeatherSource()


def make_scheduler(store, irrigation, clock, source, **kwargs) -> Scheduler:
    kwargs.setdefault("lookback", timedelta(hours=2))
    return Scheduler(
        store=store,
        service=irrigation,
        clock=clock,
        timezone="America/Detroit",
        weather_source=source,
        **kwargs,
    )


async def tick(scheduler: Scheduler) -> None:
    await scheduler.tick()
    await drain()


async def fire_0600(scheduler: Scheduler, clock: FakeClock) -> None:
    """Advance past 06:00 and evaluate the occurrence."""
    await clock.advance(4)  # 06:00:02
    await tick(scheduler)


async def run_to_completion(clock: FakeClock, minutes: int = 10) -> None:
    await clock.advance(minutes * 60 + 5)
    await drain()


# --------------------------------------------- M3.E1: each rule, exact edges


async def test_rain_lookback_skips_at_exact_threshold(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings(rain_lookback_mm=6.0)
    source.past24_mm = 6.0  # >= not > — the boundary itself skips
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)

    run = store.runs[0]
    assert run["status"] == "skipped_weather"
    assert run["note"] == "rain 6.0mm in last 24h (threshold 6.0)"
    assert run["initiator"] == "schedule"
    assert run["scheduled_for"] == local(6, 0).astimezone(UTC)
    assert irrigation.start_calls() == []  # no module commands
    assert irrigation.stop_count() == 0


async def test_rain_just_below_threshold_waters(store, irrigation, clock, source):
    store.weather_settings = make_weather_settings(rain_lookback_mm=6.0)
    source.past24_mm = 5.9
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)

    run = store.runs[0]
    assert run["status"] == "completed"
    assert run["note"] is None  # weather had data and said nothing
    assert irrigation.start_calls() == [(1, 1)]


async def test_forecast_lookahead_skips_at_exact_threshold(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings(forecast_lookahead_mm=4.0)
    source.next6_mm = 4.0
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)

    run = store.runs[0]
    assert run["status"] == "skipped_weather"
    assert run["note"] == "forecast 4.0mm next 6h (threshold 4.0)"
    assert irrigation.start_calls() == []


async def test_freeze_skips_at_exact_threshold(store, irrigation, clock, source):
    store.weather_settings = make_weather_settings(freeze_temp_c=1.0)
    source.current_temp_c = 1.0  # <= — the boundary itself skips
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)

    run = store.runs[0]
    assert run["status"] == "skipped_weather"
    assert run["note"] == "freeze guard: 1.0°C (threshold 1.0)"
    assert irrigation.start_calls() == []


async def test_freeze_just_above_threshold_waters(store, irrigation, clock, source):
    store.weather_settings = make_weather_settings(freeze_temp_c=1.0)
    source.current_temp_c = 1.1
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)

    assert store.runs[0]["status"] == "completed"
    assert irrigation.start_calls() == [(1, 1)]


async def test_skip_note_shows_the_values_used(store, irrigation, clock, source):
    """The note carries the snapshot values verbatim (spec example)."""
    store.weather_settings = make_weather_settings(rain_lookback_mm=6.0)
    source.past24_mm = 9.2
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)

    assert store.runs[0]["note"] == "rain 9.2mm in last 24h (threshold 6.0)"


# ----------------------------------- M3.E2: failure paths never cause skips


async def test_weather_disabled_waters_without_fetching(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings(enabled=False)
    source.past24_mm = 99.0  # would skip if consulted
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)

    run = store.runs[0]
    assert run["status"] == "completed"
    assert run["note"] is None
    assert source.fetches == 0


async def test_enabled_with_null_coords_waters_with_no_data_note(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings(latitude=None, longitude=None)
    source.past24_mm = 99.0
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)

    run = store.runs[0]
    assert run["status"] == "completed"
    assert "no weather data" in run["note"]
    assert source.fetches == 0
    assert irrigation.start_calls() == [(1, 1)]


async def test_fetch_failure_waters_with_no_data_note(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings()
    source.past24_mm = 99.0  # would skip, but the fetch never succeeds
    source.fail_fetches = 99
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)

    run = store.runs[0]
    assert run["status"] == "completed"
    assert "no weather data" in run["note"]
    assert irrigation.start_calls() == [(1, 1)]


async def test_stale_snapshot_beyond_2h_waters_with_no_data_note(
    store, irrigation, clock, source
):
    """A snapshot older than 2h is unusable: refetch fails -> water + note,
    even though the (stale) values would have skipped."""
    store.weather_settings = make_weather_settings()
    store.programs = [make_program(times=("06:00", "08:31"), steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source, lookback=timedelta(minutes=30))

    await fire_0600(scheduler, clock)  # fetch #1: benign values, waters
    await run_to_completion(clock, 1)
    assert store.runs[0]["status"] == "completed"
    assert source.fetches == 1

    source.past24_mm = 99.0  # new conditions would skip…
    source.fail_fetches = 99  # …but the API is down
    await clock.advance((2 * 60 + 31) * 60 - 60 - 5)  # 08:31:02
    await tick(scheduler)
    await run_to_completion(clock, 1)

    second = store.runs[1]
    assert second["status"] == "completed"  # never skip from a failure path
    assert "no weather data" in second["note"]


async def test_cached_snapshot_within_2h_still_decides_when_refetch_fails(
    store, irrigation, clock, source
):
    """Cache 45min old, refetch fails: the <=2h-old snapshot is still valid
    and its values still skip."""
    store.weather_settings = make_weather_settings(rain_lookback_mm=6.0)
    source.past24_mm = 9.2
    store.programs = [make_program(times=("06:00", "06:45"))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    assert store.runs[0]["status"] == "skipped_weather"
    assert source.fetches == 1

    source.fail_fetches = 99
    await clock.advance(45 * 60)  # 06:45:02
    await tick(scheduler)

    second = store.runs[1]
    assert second["status"] == "skipped_weather"
    assert second["note"] == "rain 9.2mm in last 24h (threshold 6.0)"


async def test_no_weather_settings_row_behaves_like_disabled(
    store, irrigation, clock, source
):
    store.weather_settings = None
    source.past24_mm = 99.0
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)

    assert store.runs[0]["status"] == "completed"
    assert store.runs[0]["note"] is None
    assert source.fetches == 0


# ------------------------------------------- M3.E3: run-now bypasses weather


async def test_run_now_bypasses_weather_entirely(store, irrigation, clock, source):
    store.weather_settings = make_weather_settings(rain_lookback_mm=6.0)
    source.past24_mm = 99.0  # scheduled runs would skip
    store.programs = [make_program(steps=((1, 1),))]
    store.add_run_request(1, "drew.payment@gmail.com")
    scheduler = make_scheduler(store, irrigation, clock, source)

    await tick(scheduler)  # 05:59:58 — claims the request, before 06:00
    await run_to_completion(clock, 1)

    run = store.runs[0]
    assert run["status"] == "completed"
    assert run["initiator"] == "drew.payment@gmail.com"
    assert run["scheduled_for"] is None
    assert irrigation.start_calls() == [(1, 1)]
    assert source.fetches == 0  # not even a fetch


async def test_program_not_respecting_rain_delay_skips_weather_too(
    store, irrigation, clock, source
):
    """One flag governs both rain-delay and weather deference (W1 note)."""
    store.weather_settings = make_weather_settings()
    source.past24_mm = 99.0
    store.programs = [make_program(respect_rain_delay=False, steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)

    assert store.runs[0]["status"] == "completed"
    assert source.fetches == 0


# ------------------------------------------------ M3.E4: rain delay ordering


async def test_active_rain_delay_wins_over_weather(store, irrigation, clock, source):
    store.weather_settings = make_weather_settings()
    source.past24_mm = 99.0  # weather would also skip
    irrigation.rain_delay = 2
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)

    run = store.runs[0]
    assert run["status"] == "skipped_rain_delay"  # not skipped_weather
    assert "rain delay" in run["note"]
    assert source.fetches == 0  # weather never consulted behind a rain delay


# --------------------------------------------------- M3.E5: cache semantics


async def test_at_most_one_fetch_per_30_minutes(store, irrigation, clock, source):
    store.weather_settings = make_weather_settings()
    store.programs = [
        make_program(times=("06:00", "06:10", "06:20"), steps=((1, 1),))
    ]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)  # fetch #1
    await run_to_completion(clock, 1)
    for minutes in (9, 10):  # 06:10:02+, 06:20:02+
        await clock.advance(minutes * 60)
        await tick(scheduler)
        await run_to_completion(clock, 1)

    assert len(store.runs_with("completed")) == 3
    assert source.fetches == 1  # 20 minutes of evaluations, one fetch

    # Past the 30-minute cache window a new evaluation refetches.
    store.programs = [
        make_program(times=("06:00", "06:10", "06:20", "06:55"), steps=((1, 1),))
    ]
    scheduler._on_notify()
    await clock.advance(33 * 60)  # 06:55:02
    await tick(scheduler)
    assert source.fetches == 2


async def test_settings_change_forces_refetch_at_next_evaluation(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings(rain_lookback_mm=6.0)
    source.past24_mm = 5.0  # below threshold: waters
    store.programs = [make_program(times=("06:00", "06:10"), steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)
    assert store.runs[0]["status"] == "completed"
    assert source.fetches == 1

    # Admin tightens the threshold; the web app fires NOTIFY. The gate must
    # refetch (not reuse the 10-minute-old snapshot) at the next evaluation.
    store.weather_settings = make_weather_settings(
        rain_lookback_mm=4.0, updated_at=datetime(2026, 7, 15, 10, 5, tzinfo=UTC)
    )
    scheduler._on_notify()
    await clock.advance(10 * 60)  # 06:10:02
    await tick(scheduler)

    assert source.fetches == 2
    assert store.runs[1]["status"] == "skipped_weather"
    assert store.runs[1]["note"] == "rain 5.0mm in last 24h (threshold 4.0)"


# ---------------------------------------- M3.E6: 15s poll pickup, no NOTIFY


async def test_settings_enable_picked_up_within_15s_without_notify(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings(enabled=False)
    source.past24_mm = 99.0
    store.programs = [make_program(times=("06:01",))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await tick(scheduler)  # initial refresh sees weather disabled

    # Enabled in the DB; no NOTIFY ever arrives. The 15s poll must pick it
    # up before the 06:01 occurrence fires (63s later).
    store.weather_settings = make_weather_settings(
        enabled=True, updated_at=datetime(2026, 7, 15, 10, 0, 30, tzinfo=UTC)
    )
    await clock.advance(63)  # 06:01:01 — refresh is >15s overdue
    await tick(scheduler)

    assert store.runs[0]["status"] == "skipped_weather"
    assert irrigation.start_calls() == []


async def test_threshold_change_picked_up_within_15s_without_notify(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings(rain_lookback_mm=6.0)
    source.past24_mm = 5.0
    store.programs = [make_program(times=("06:01",))]
    scheduler = make_scheduler(store, irrigation, clock, source)

    await tick(scheduler)
    store.weather_settings = make_weather_settings(
        rain_lookback_mm=3.0, updated_at=datetime(2026, 7, 15, 10, 0, 30, tzinfo=UTC)
    )
    await clock.advance(63)
    await tick(scheduler)

    assert store.runs[0]["status"] == "skipped_weather"
    assert store.runs[0]["note"] == "rain 5.0mm in last 24h (threshold 3.0)"


# ------------------------------------------------------ status.weather (M3)


async def test_weather_status_null_until_fetched_then_reports_snapshot(
    store, irrigation, clock, source
):
    store.weather_settings = make_weather_settings()
    source.past24_mm = 9.2
    source.next6_mm = 0.3
    source.current_temp_c = 18.5
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock, source)

    assert scheduler.weather_status() is None  # never fetched

    await fire_0600(scheduler, clock)  # evaluation fetches (and skips)

    status = scheduler.weather_status()
    assert status == {
        "fetched_at": local(6, 0, 2).astimezone(UTC).isoformat(),
        "past24_mm": 9.2,
        "next6_mm": 0.3,
        "current_temp_c": 18.5,
        "enabled": True,
    }


async def test_weather_status_null_when_disabled(store, irrigation, clock, source):
    store.weather_settings = make_weather_settings()
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock, source)
    await fire_0600(scheduler, clock)
    await run_to_completion(clock, 1)
    assert scheduler.weather_status() is not None

    # Admin turns weather off; the next refresh adopts it -> status null.
    store.weather_settings = make_weather_settings(
        enabled=False, updated_at=datetime(2026, 7, 15, 11, 0, tzinfo=UTC)
    )
    scheduler._on_notify()
    await tick(scheduler)
    assert scheduler.weather_status() is None


async def test_weather_status_none_without_weather_source(store, irrigation, clock):
    scheduler = Scheduler(
        store=store, service=irrigation, clock=clock, timezone="America/Detroit"
    )
    assert scheduler.weather_status() is None


# ------------------------------------------------- open-meteo payload parse


def test_parse_open_meteo_windows_and_none_handling():
    """Bucket t counts toward past24 iff now-24h < t <= now, toward next6 iff
    now < t <= now+6h; None precipitation counts as 0; current temperature is
    the newest reading at or before now."""
    now = datetime(2026, 7, 15, 12, 30, tzinfo=UTC)
    base = datetime(2026, 7, 13, 0, 0, tzinfo=UTC)
    times, precip, temps = [], [], []
    for i in range(96):  # past_days=2 + forecast_days=2, hourly
        t = base + timedelta(hours=i)
        times.append(t.strftime("%Y-%m-%dT%H:%M"))
        if t == datetime(2026, 7, 14, 13, 0, tzinfo=UTC):
            precip.append(1.25)  # 23h30m ago — inside (now-24h, now]
        elif t == datetime(2026, 7, 14, 12, 0, tzinfo=UTC):
            precip.append(50.0)  # 24h30m ago — outside the lookback
        elif t == datetime(2026, 7, 15, 12, 0, tzinfo=UTC):
            precip.append(2.0)  # the bucket containing `now` (t <= now)
        elif t == datetime(2026, 7, 15, 18, 0, tzinfo=UTC):
            precip.append(0.75)  # now+5h30m — inside (now, now+6h]
        elif t == datetime(2026, 7, 15, 19, 0, tzinfo=UTC):
            precip.append(40.0)  # now+6h30m — outside the lookahead
        elif t == datetime(2026, 7, 15, 15, 0, tzinfo=UTC):
            precip.append(None)  # missing data -> 0, not an error
        else:
            precip.append(0.0)
        temps.append(21.5 if t <= now else None)
    data = {"hourly": {"time": times, "precipitation": precip, "temperature_2m": temps}}

    snap = parse_open_meteo(data, now)

    assert snap.past24_mm == 3.25  # 1.25 + 2.0
    assert snap.next6_mm == 0.75
    assert snap.current_temp_c == 21.5
    assert snap.fetched_at == now


def test_parse_open_meteo_rejects_mismatched_arrays():
    data = {
        "hourly": {
            "time": ["2026-07-15T00:00"],
            "precipitation": [0.0, 0.0],
            "temperature_2m": [20.0],
        }
    }
    with pytest.raises(Exception):
        parse_open_meteo(data, datetime(2026, 7, 15, 1, 0, tzinfo=UTC))


def test_weather_settings_equality_drives_cache_invalidation():
    """update_settings invalidates the snapshot only when something changed
    (updated_at counts as a change — a save with identical values refetches)."""
    from app.weather import WeatherGate, WeatherSnapshot

    gate = WeatherGate(FakeWeatherSource())
    first = make_weather_settings()
    gate.update_settings(first)
    gate.snapshot = WeatherSnapshot(
        fetched_at=datetime(2026, 7, 15, 10, 0, tzinfo=UTC),
        past24_mm=1.0,
        next6_mm=0.0,
        current_temp_c=20.0,
    )
    gate.update_settings(make_weather_settings())  # identical row — keep cache
    assert gate.snapshot is not None
    gate.update_settings(
        make_weather_settings(updated_at=datetime(2026, 7, 15, 10, 1, tzinfo=UTC))
    )
    assert gate.snapshot is None


def test_weather_settings_is_frozen_dataclass():
    settings = make_weather_settings()
    with pytest.raises(Exception):
        settings.enabled = False  # type: ignore[misc]
