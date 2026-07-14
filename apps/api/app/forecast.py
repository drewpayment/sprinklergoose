"""M4.M: forecast predictions for GET /api/forecast.

For each occurrence of an enabled program in the next 48h, predicts whether
it will water or be skipped — mirroring the live skip-decision precedence in
scheduler.py's `_execute` (rain-delay check, then weather.py's rules) without
any side effects: no weather fetch, no controller/module traffic. Everything
here reads only already-cached state (WeatherGate.settings/snapshot, a
cached rain-delay day count) that the scheduler/status-poll machinery keeps
fresh on its own cadence.

Precedence (docs/M4-MAP-SPEC.md):
  1. program.respect_rain_delay is False -> "watering" (ignores everything).
  2. controller rain delay active and the occurrence falls inside the
     window (now .. now + N days) -> "rain_delay".
  3. weather rules, same thresholds/order/wording as weather._decide (via
     weather.classify_conditions), evaluated over window sums computed at
     the occurrence time T rather than "now":
       past24(T) = sum over (T-24h, T], next6(T) = sum over (T, T+6h],
       temp(T)   = newest hourly bucket at or before T.
  4. no usable weather data (disabled / no coords / stale / no snapshot /
     no temperature bucket) -> "unknown" (rules 1-2 still apply above).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from .weather import (
    STALE_SECONDS,
    HourlyBucket,
    WeatherGate,
    WeatherSettings,
    WeatherSnapshot,
    classify_conditions,
)

if TYPE_CHECKING:
    from .scheduler import Program

FORECAST_HORIZON = timedelta(hours=48)
MAX_UPCOMING = 20

PREDICTION_WATERING = "watering"
PREDICTION_SKIP_RAIN = "skip_rain"
PREDICTION_SKIP_FORECAST = "skip_forecast"
PREDICTION_SKIP_FREEZE = "skip_freeze"
PREDICTION_RAIN_DELAY = "rain_delay"
PREDICTION_UNKNOWN = "unknown"

_CATEGORY_TO_PREDICTION = {
    "rain": PREDICTION_SKIP_RAIN,
    "forecast": PREDICTION_SKIP_FORECAST,
    "freeze": PREDICTION_SKIP_FREEZE,
}


@dataclass(frozen=True)
class UpcomingRun:
    program_id: int
    program_name: str
    at: datetime  # aware, executor-local timezone (same convention as next_scheduled)
    prediction: str
    note: str | None


@dataclass(frozen=True)
class ForecastResult:
    enabled: bool  # mirrors weather_settings.enabled verbatim
    weather: WeatherSnapshot | None  # None when disabled/no coords/stale/unfetched
    hourly: tuple[HourlyBucket, ...]  # [] when weather is None
    upcoming: tuple[UpcomingRun, ...]


# --------------------------------------------------------------- window math


def _sum_window(
    hourly: tuple[HourlyBucket, ...], start_exclusive: datetime, end_inclusive: datetime
) -> float:
    return round(
        sum(b.precip_mm for b in hourly if start_exclusive < b.time <= end_inclusive),
        2,
    )


def _temp_at_or_before(
    hourly: tuple[HourlyBucket, ...], t: datetime
) -> float | None:
    """Newest bucket at or before `t` with a known temperature, or None."""
    best: HourlyBucket | None = None
    for bucket in hourly:
        if bucket.time <= t and bucket.temp_c is not None:
            if best is None or bucket.time > best.time:
                best = bucket
    return best.temp_c if best else None


def weather_is_usable(
    settings: WeatherSettings | None, snapshot: WeatherSnapshot | None, now: datetime
) -> bool:
    """Same usability gate as WeatherGate.evaluate()'s failure paths, minus
    the fetch — a stale/missing/unconfigured snapshot can't back a
    prediction any more than it can back a live skip decision."""
    if settings is None or not settings.enabled:
        return False
    if settings.latitude is None or settings.longitude is None:
        return False
    if snapshot is None:
        return False
    if (now - snapshot.fetched_at).total_seconds() > STALE_SECONDS:
        return False
    return True


# ----------------------------------------------------------------- predict


def predict_occurrence(
    program: "Program",
    occ: datetime,
    now: datetime,
    settings: WeatherSettings | None,
    snapshot: WeatherSnapshot | None,
    weather_usable: bool,
    rain_delay_days: int | None,
) -> tuple[str, str | None]:
    """The prediction for one occurrence, per the precedence above."""
    if not program.respect_rain_delay:
        return PREDICTION_WATERING, "ignores rain delay and weather"

    if rain_delay_days and rain_delay_days > 0:
        delay_end = now + timedelta(days=rain_delay_days)
        if occ <= delay_end:
            plural = "s" if rain_delay_days != 1 else ""
            return (
                PREDICTION_RAIN_DELAY,
                "skipped: controller rain delay active "
                f"({rain_delay_days} day{plural} remaining)",
            )

    if not weather_usable:
        return PREDICTION_UNKNOWN, "no weather data"

    assert snapshot is not None and settings is not None  # weather_usable guarantees this
    past24 = _sum_window(snapshot.hourly, occ - timedelta(hours=24), occ)
    next6 = _sum_window(snapshot.hourly, occ, occ + timedelta(hours=6))
    temp = _temp_at_or_before(snapshot.hourly, occ)
    if temp is None:
        return PREDICTION_UNKNOWN, "no weather data"

    category, note = classify_conditions(
        settings,
        WeatherSnapshot(
            fetched_at=occ, past24_mm=past24, next6_mm=next6, current_temp_c=temp
        ),
    )
    if category is not None:
        return _CATEGORY_TO_PREDICTION[category], note
    return PREDICTION_WATERING, None


# ------------------------------------------------------------- build_forecast


def build_forecast(
    programs,
    now: datetime,
    tz: ZoneInfo,
    weather: WeatherGate | None,
    rain_delay_days: int | None,
    horizon: timedelta = FORECAST_HORIZON,
    max_items: int = MAX_UPCOMING,
) -> ForecastResult:
    """Assembles the GET /api/forecast payload's data. `programs` is the
    scheduler's in-memory Program dict's values (already-loaded config —
    no DB read here). `rain_delay_days` is a cached value (see
    RainbirdService.cached_rain_delay_days) — this function never talks to
    the controller or fetches weather."""
    from .scheduler import occurrences_between  # deferred: avoids a circular import

    settings = weather.settings if weather is not None else None
    snapshot = weather.snapshot if weather is not None else None
    usable = weather_is_usable(settings, snapshot, now)
    enabled = bool(settings is not None and settings.enabled)

    hourly: tuple[HourlyBucket, ...] = ()
    weather_out: WeatherSnapshot | None = None
    if usable:
        assert snapshot is not None
        weather_out = snapshot
        hourly = tuple(b for b in snapshot.hourly if now <= b.time <= now + horizon)

    occs: list[tuple["Program", datetime]] = []
    for program in programs:
        if not program.enabled or not program.steps:
            continue
        for occ in occurrences_between(program, now, now + horizon, tz):
            occs.append((program, occ))
    occs.sort(key=lambda item: item[1])
    occs = occs[:max_items]

    upcoming: list[UpcomingRun] = []
    for program, occ in occs:
        prediction, note = predict_occurrence(
            program, occ, now, settings, snapshot, usable, rain_delay_days
        )
        upcoming.append(
            UpcomingRun(
                program_id=program.id,
                program_name=program.name,
                at=occ.astimezone(tz),
                prediction=prediction,
                note=note,
            )
        )

    return ForecastResult(
        enabled=enabled, weather=weather_out, hourly=hourly, upcoming=tuple(upcoming)
    )
