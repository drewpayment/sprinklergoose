"""M4.M unit tests: forecast prediction semantics (docs/M4-MAP-SPEC.md E1-E4).

Mirrors the layout of test_weather_unit.py: deterministic, no network, no
database. Most tests call predict_occurrence()/build_forecast() directly
with a hand-built WeatherGate (settings + snapshot set directly, exactly
like test_weather_settings_equality_drives_cache_invalidation does) so
window math can be pinned to exact boundary instants without going through
a real fetch.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.forecast import (
    PREDICTION_RAIN_DELAY,
    PREDICTION_SKIP_FORECAST,
    PREDICTION_SKIP_FREEZE,
    PREDICTION_SKIP_RAIN,
    PREDICTION_UNKNOWN,
    PREDICTION_WATERING,
    build_forecast,
    predict_occurrence,
    weather_is_usable,
)
from app.weather import HourlyBucket, WeatherGate, WeatherSnapshot

from .scheduler_testkit import TZ, FakeWeatherSource, make_program, make_weather_settings

T = datetime(2026, 7, 15, 12, 0, tzinfo=UTC)  # a fixed occurrence instant


def gate(settings=None, snapshot=None) -> WeatherGate:
    g = WeatherGate(FakeWeatherSource())
    g.settings = settings
    g.snapshot = snapshot
    return g


# ------------------------------------------------ E2: precedence, rule 1

def test_respect_rain_delay_false_always_waters_even_with_delay_and_bad_weather():
    program = make_program(respect_rain_delay=False)
    settings = make_weather_settings(rain_lookback_mm=0.0)  # would always skip
    snapshot = WeatherSnapshot(
        fetched_at=T, past24_mm=99.0, next6_mm=99.0, current_temp_c=-10.0
    )
    prediction, note = predict_occurrence(
        program,
        occ=T,
        now=T - timedelta(hours=1),
        settings=settings,
        snapshot=snapshot,
        weather_usable=True,
        rain_delay_days=5,  # would also skip
    )
    assert prediction == PREDICTION_WATERING
    assert note == "ignores rain delay and weather"


# ------------------------------------------------ E2: precedence, rule 2


def test_rain_delay_window_predicts_rain_delay_when_occurrence_falls_inside_it():
    program = make_program()
    now = T - timedelta(hours=1)
    prediction, note = predict_occurrence(
        program,
        occ=T,  # 1h after now; well inside a 2-day window
        now=now,
        settings=make_weather_settings(rain_lookback_mm=0.0),  # would also skip
        snapshot=WeatherSnapshot(fetched_at=now, past24_mm=99.0, next6_mm=0, current_temp_c=20),
        weather_usable=True,
        rain_delay_days=2,
    )
    assert prediction == PREDICTION_RAIN_DELAY
    assert note == "skipped: controller rain delay active (2 days remaining)"


def test_rain_delay_window_singular_day_wording():
    program = make_program()
    now = T - timedelta(hours=1)
    _, note = predict_occurrence(
        program, occ=T, now=now, settings=None, snapshot=None,
        weather_usable=False, rain_delay_days=1,
    )
    assert note == "skipped: controller rain delay active (1 day remaining)"


_BENIGN_HOURLY = (HourlyBucket(time=T, precip_mm=0.0, temp_c=20.0),)


def test_occurrence_outside_rain_delay_window_falls_through_to_weather():
    program = make_program()
    now = T - timedelta(days=3)  # delay window ends at now+1day, well before T
    prediction, note = predict_occurrence(
        program,
        occ=T,
        now=now,
        settings=make_weather_settings(),
        snapshot=WeatherSnapshot(
            fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=20,
            hourly=_BENIGN_HOURLY,
        ),
        weather_usable=True,
        rain_delay_days=1,
    )
    assert prediction == PREDICTION_WATERING
    assert note is None


def test_zero_rain_delay_days_does_not_trigger_rain_delay():
    program = make_program()
    now = T - timedelta(hours=1)
    prediction, _ = predict_occurrence(
        program,
        occ=T,
        now=now,
        settings=make_weather_settings(),
        snapshot=WeatherSnapshot(
            fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=20,
            hourly=_BENIGN_HOURLY,
        ),
        weather_usable=True,
        rain_delay_days=0,
    )
    assert prediction == PREDICTION_WATERING


def test_none_rain_delay_days_does_not_trigger_rain_delay():
    """No cached rain-delay value (status never polled) — treated as no
    active delay rather than crashing or guessing skip."""
    program = make_program()
    now = T - timedelta(hours=1)
    prediction, _ = predict_occurrence(
        program,
        occ=T,
        now=now,
        settings=make_weather_settings(),
        snapshot=WeatherSnapshot(
            fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=20,
            hourly=_BENIGN_HOURLY,
        ),
        weather_usable=True,
        rain_delay_days=None,
    )
    assert prediction == PREDICTION_WATERING


# --------------------------------------- E2/E3: weather rules, window edges


def _snapshot_with_boundary_buckets() -> WeatherSnapshot:
    """Buckets pinned exactly at T-24h (excluded), T-23h (included in
    past24), T (included in both current-temp and past24), T+6h (included
    in next6), and T+7h (excluded from next6)."""
    hourly = (
        HourlyBucket(time=T - timedelta(hours=24), precip_mm=100.0, temp_c=20.0),
        HourlyBucket(time=T - timedelta(hours=23), precip_mm=1.0, temp_c=20.0),
        HourlyBucket(time=T, precip_mm=2.0, temp_c=15.0),
        HourlyBucket(time=T + timedelta(hours=6), precip_mm=3.0, temp_c=20.0),
        HourlyBucket(time=T + timedelta(hours=7), precip_mm=100.0, temp_c=20.0),
    )
    return WeatherSnapshot(
        fetched_at=T - timedelta(hours=1), past24_mm=0, next6_mm=0, current_temp_c=0,
        hourly=hourly,
    )


def test_past24_window_excludes_bucket_exactly_at_t_minus_24h():
    """past24(T) = sum over (T-24h, T]: the T-24h bucket itself (100mm) must
    NOT count, or the exact-threshold skip below would trip on it."""
    program = make_program()
    snapshot = _snapshot_with_boundary_buckets()
    settings = make_weather_settings(rain_lookback_mm=3.0)  # 1.0 + 2.0 == 3.0 exactly
    prediction, note = predict_occurrence(
        program, occ=T, now=T - timedelta(hours=1), settings=settings, snapshot=snapshot,
        weather_usable=True, rain_delay_days=0,
    )
    assert prediction == PREDICTION_SKIP_RAIN
    assert note == "rain 3.0mm in last 24h (threshold 3.0)"


def test_next6_window_includes_bucket_exactly_at_t_plus_6h():
    """next6(T) = sum over (T, T+6h]: the T+6h bucket (3mm) counts, the
    T+7h bucket (100mm) does not."""
    program = make_program()
    snapshot = _snapshot_with_boundary_buckets()
    settings = make_weather_settings(
        rain_lookback_mm=999.0, forecast_lookahead_mm=3.0  # exact threshold
    )
    prediction, note = predict_occurrence(
        program, occ=T, now=T - timedelta(hours=1), settings=settings, snapshot=snapshot,
        weather_usable=True, rain_delay_days=0,
    )
    assert prediction == PREDICTION_SKIP_FORECAST
    assert note == "forecast 3.0mm next 6h (threshold 3.0)"


def test_temp_at_t_uses_newest_bucket_at_or_before_t():
    """temp(T) = newest bucket <= T: the bucket at exactly T (15C) wins over
    the older T-23h bucket (20C)."""
    program = make_program()
    snapshot = _snapshot_with_boundary_buckets()
    settings = make_weather_settings(
        rain_lookback_mm=999.0, forecast_lookahead_mm=999.0, freeze_temp_c=15.0
    )
    prediction, note = predict_occurrence(
        program, occ=T, now=T - timedelta(hours=1), settings=settings, snapshot=snapshot,
        weather_usable=True, rain_delay_days=0,
    )
    assert prediction == PREDICTION_SKIP_FREEZE
    assert note == "freeze guard: 15.0°C (threshold 15.0)"


def test_rule_precedence_rain_beats_forecast_beats_freeze():
    """When multiple rules would fire, the same order as weather._decide
    wins: rain, then forecast, then freeze."""
    program = make_program()
    now = T - timedelta(hours=1)
    settings = make_weather_settings(
        rain_lookback_mm=1.0, forecast_lookahead_mm=1.0, freeze_temp_c=99.0
    )
    snapshot = WeatherSnapshot(
        fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=0,
        hourly=(HourlyBucket(time=T, precip_mm=5.0, temp_c=-5.0),),
    )
    prediction, _ = predict_occurrence(
        program, occ=T, now=now, settings=settings, snapshot=snapshot,
        weather_usable=True, rain_delay_days=0,
    )
    assert prediction == PREDICTION_SKIP_RAIN  # not forecast or freeze


def test_below_all_thresholds_waters_with_no_note():
    program = make_program()
    now = T - timedelta(hours=1)
    settings = make_weather_settings()
    snapshot = WeatherSnapshot(
        fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=0,
        hourly=(HourlyBucket(time=T, precip_mm=0.0, temp_c=20.0),),
    )
    prediction, note = predict_occurrence(
        program, occ=T, now=now, settings=settings, snapshot=snapshot,
        weather_usable=True, rain_delay_days=0,
    )
    assert prediction == PREDICTION_WATERING
    assert note is None


# --------------------------------------------------------- E4: no usable data


def test_weather_unusable_gives_unknown_with_note():
    program = make_program()
    prediction, note = predict_occurrence(
        program, occ=T, now=T - timedelta(hours=1), settings=None, snapshot=None,
        weather_usable=False, rain_delay_days=0,
    )
    assert prediction == PREDICTION_UNKNOWN
    assert note == "no weather data"


def test_missing_temp_bucket_gives_unknown_even_with_precip_data():
    """past24/next6 default to 0 with no coverage (never falsely skip), but
    a missing current-temperature bucket alone makes the whole rule set
    unusable -> unknown, not a guessed freeze verdict."""
    program = make_program()
    now = T - timedelta(hours=1)
    settings = make_weather_settings()
    snapshot = WeatherSnapshot(
        fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=0,
        hourly=(HourlyBucket(time=T + timedelta(hours=1), precip_mm=0.0, temp_c=20.0),),
    )
    prediction, note = predict_occurrence(
        program, occ=T, now=now, settings=settings, snapshot=snapshot,
        weather_usable=True, rain_delay_days=0,
    )
    assert prediction == PREDICTION_UNKNOWN
    assert note == "no weather data"


def test_weather_is_usable_false_cases():
    now = T
    fresh = WeatherSnapshot(fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=0)
    assert weather_is_usable(None, fresh, now) is False
    assert weather_is_usable(make_weather_settings(enabled=False), fresh, now) is False
    assert (
        weather_is_usable(
            make_weather_settings(latitude=None, longitude=None), fresh, now
        )
        is False
    )
    assert weather_is_usable(make_weather_settings(), None, now) is False
    stale = WeatherSnapshot(
        fetched_at=now - timedelta(hours=3), past24_mm=0, next6_mm=0, current_temp_c=0
    )
    assert weather_is_usable(make_weather_settings(), stale, now) is False
    assert weather_is_usable(make_weather_settings(), fresh, now) is True


# ------------------------------------------------------ E4: disabled fallback


def test_disabled_settings_rules_1_and_2_still_apply():
    """Weather disabled entirely: rule 1 (ignores everything) and rule 2
    (rain delay) still work; only the weather rules degrade to unknown."""
    now = T - timedelta(hours=1)
    disabled = make_weather_settings(enabled=False)

    ignoring = make_program(respect_rain_delay=False)
    prediction, note = predict_occurrence(
        ignoring, occ=T, now=now, settings=disabled, snapshot=None,
        weather_usable=weather_is_usable(disabled, None, now), rain_delay_days=3,
    )
    assert prediction == PREDICTION_WATERING
    assert note == "ignores rain delay and weather"

    respecting = make_program(respect_rain_delay=True)
    prediction, note = predict_occurrence(
        respecting, occ=T, now=now, settings=disabled, snapshot=None,
        weather_usable=weather_is_usable(disabled, None, now), rain_delay_days=3,
    )
    assert prediction == PREDICTION_RAIN_DELAY

    prediction, note = predict_occurrence(
        respecting, occ=T, now=now, settings=disabled, snapshot=None,
        weather_usable=weather_is_usable(disabled, None, now), rain_delay_days=0,
    )
    assert prediction == PREDICTION_UNKNOWN
    assert note == "no weather data"


# --------------------------------------------------------------- build_forecast


def test_build_forecast_enabled_mirrors_settings_even_when_weather_unusable():
    """enabled mirrors weather_settings.enabled verbatim; a missing location
    still reports enabled=true but weather=null/hourly=[] (M4 spec)."""
    now = T
    settings = make_weather_settings(latitude=None, longitude=None)  # enabled, no coords
    g = gate(settings=settings, snapshot=None)
    program = make_program(program_id=1, name="Lawn", times=("13:00",))

    result = build_forecast([program], now, TZ, g, rain_delay_days=0)

    assert result.enabled is True
    assert result.weather is None
    assert result.hourly == ()
    # Daily program: two occurrences fall inside the 48h horizon (today's
    # and tomorrow's 13:00) — both unknown since weather is unusable.
    assert len(result.upcoming) == 2
    assert {u.prediction for u in result.upcoming} == {PREDICTION_UNKNOWN}


def test_build_forecast_no_weather_gate_at_all():
    now = T
    program = make_program(program_id=1, name="Lawn", times=("13:00",))
    result = build_forecast([program], now, TZ, None, rain_delay_days=0)
    assert result.enabled is False
    assert result.weather is None
    assert result.hourly == ()
    assert result.upcoming[0].prediction == PREDICTION_UNKNOWN


def test_build_forecast_hourly_clipped_to_now_through_48h():
    now = T
    settings = make_weather_settings()
    hourly = (
        HourlyBucket(time=now - timedelta(hours=1), precip_mm=0.0, temp_c=20.0),  # before now
        HourlyBucket(time=now, precip_mm=0.1, temp_c=20.0),  # at now
        HourlyBucket(time=now + timedelta(hours=48), precip_mm=0.2, temp_c=20.0),  # at +48h
        HourlyBucket(time=now + timedelta(hours=49), precip_mm=0.3, temp_c=20.0),  # after +48h
    )
    snapshot = WeatherSnapshot(
        fetched_at=now, past24_mm=0, next6_mm=0, current_temp_c=20.0, hourly=hourly
    )
    g = gate(settings=settings, snapshot=snapshot)
    result = build_forecast([], now, TZ, g, rain_delay_days=0)
    assert [b.time for b in result.hourly] == [now, now + timedelta(hours=48)]


def test_build_forecast_skips_disabled_and_stepless_programs():
    now = T
    disabled_program = make_program(program_id=1, times=("13:00",), enabled=False)
    stepless = make_program(program_id=2, times=("13:00",), steps=())
    result = build_forecast([disabled_program, stepless], now, TZ, None, rain_delay_days=0)
    assert result.upcoming == ()


def test_build_forecast_caps_at_20_sorted_ascending():
    now = T
    many_times = tuple(f"{h:02d}:00" for h in range(24))  # 24 occurrences/day
    program = make_program(program_id=1, name="Lawn", times=many_times)
    result = build_forecast([program], now, TZ, None, rain_delay_days=0)
    assert len(result.upcoming) == 20
    ats = [u.at for u in result.upcoming]
    assert ats == sorted(ats)


def test_build_forecast_at_field_reflects_dst_transition():
    """The `at` field uses the executor-local timezone with offset, same
    convention as next_scheduled — including across a DST transition."""
    now = datetime(2026, 10, 30, 12, 0, tzinfo=UTC)  # 08:00 EDT
    tz = ZoneInfo("America/Detroit")
    program = make_program(program_id=1, name="Lawn", times=("06:00",))
    result = build_forecast([program], now, tz, None, rain_delay_days=0)
    ats = [u.at.isoformat() for u in result.upcoming]
    # US DST ends 2026-11-01: Oct 31 is still EDT (-04:00), Nov 1 is EST (-05:00).
    assert ats == [
        "2026-10-31T06:00:00-04:00",
        "2026-11-01T06:00:00-05:00",
    ]


# ------------------------------------------------ refresh(): warm snapshot cache

async def test_refresh_populates_snapshot_when_enabled_with_coords():
    src = FakeWeatherSource(current_temp_c=24.5)
    g = WeatherGate(src)
    g.update_settings(make_weather_settings())
    await g.refresh(T)
    assert g.snapshot is not None
    assert g.snapshot.current_temp_c == 24.5
    assert src.fetches == 1


async def test_refresh_noop_when_disabled_or_unconfigured():
    src = FakeWeatherSource()
    g = WeatherGate(src)
    g.update_settings(make_weather_settings(enabled=False))
    await g.refresh(T)
    g.update_settings(make_weather_settings(latitude=None, longitude=None))
    await g.refresh(T)
    assert g.snapshot is None
    assert src.fetches == 0


async def test_refresh_respects_cache_window():
    src = FakeWeatherSource()
    g = WeatherGate(src)
    g.update_settings(make_weather_settings())
    await g.refresh(T)
    await g.refresh(T + timedelta(minutes=29))  # inside CACHE_SECONDS — no fetch
    assert src.fetches == 1
    await g.refresh(T + timedelta(minutes=31))  # cache expired — refetch
    assert src.fetches == 2


async def test_refresh_failure_backs_off_and_never_raises():
    src = FakeWeatherSource()
    src.fail_fetches = 2
    g = WeatherGate(src)
    g.update_settings(make_weather_settings())
    await g.refresh(T)  # fails (1st fetch), recorded
    assert g.snapshot is None
    await g.refresh(T + timedelta(minutes=1))  # inside backoff — no attempt
    assert src.fetches == 1
    await g.refresh(T + timedelta(minutes=6))  # backoff over — fails (2nd)
    assert src.fetches == 2
    await g.refresh(T + timedelta(minutes=12))  # succeeds (3rd)
    assert g.snapshot is not None
    assert src.fetches == 3
