"""M3 W1: weather autonomy — skip scheduled waterings when the weather says so.

The executor owns ALL weather fetching (autonomy must not depend on the web
app). Open-Meteo (free, keyless) provides hourly precipitation + temperature
for the configured lat/lon; one request covers the past-24h lookback, the
next-6h forecast, and the current temperature.

Philosophy carried over from M2's rulings: automation restrains, humans
override, failures water. Every failure path here (fetch error, stale
snapshot, missing coordinates) results in NORMAL watering with a
"no weather data" note — a weather API outage must never brown the lawn,
and a skip must always show its work in the history note.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol

logger = logging.getLogger(__name__)

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
FETCH_TIMEOUT_SECONDS = 10.0
CACHE_SECONDS = 30 * 60  # refresh when older than 30 minutes at evaluation
STALE_SECONDS = 2 * 60 * 60  # beyond 2h a snapshot is unusable (never skip)
LOOKBACK_HOURS = 24
LOOKAHEAD_HOURS = 6


# --------------------------------------------------------------------- model


@dataclass(frozen=True)
class WeatherSettings:
    """Mirror of the singleton weather_settings row (web-next owns the DDL)."""

    enabled: bool
    latitude: float | None
    longitude: float | None
    rain_lookback_mm: float
    forecast_probability: int  # reserved for M3.1; not evaluated in M3
    forecast_lookahead_mm: float
    freeze_temp_c: float
    updated_at: datetime | None


@dataclass(frozen=True)
class HourlyBucket:
    """One Open-Meteo hourly reading (M4: retained on the snapshot so
    forecast predictions can compute window sums at arbitrary occurrence
    times, not just 'now')."""

    time: datetime  # aware UTC, the bucket's starting instant
    precip_mm: float
    temp_c: float | None


@dataclass(frozen=True)
class WeatherSnapshot:
    """The values a skip decision is based on; they go verbatim into notes.

    `hourly` (M4) is the full retained past+forecast series backing the
    three aggregates above; it defaults to empty so existing callers that
    construct a WeatherSnapshot without it (tests, fakes) are unaffected."""

    fetched_at: datetime  # aware UTC
    past24_mm: float
    next6_mm: float
    current_temp_c: float
    hourly: tuple[HourlyBucket, ...] = ()


@dataclass(frozen=True)
class WeatherDecision:
    skip: bool
    # Skip reason ("rain 9.2mm in last 24h (threshold 6.0)") when skip=True;
    # a "no weather data" annotation for the watering run when skip=False and
    # weather was wanted but unavailable; None otherwise.
    note: str | None


class WeatherSource(Protocol):
    """Injectable fetcher so unit tests never touch the network."""

    async def fetch(
        self, latitude: float, longitude: float, now: datetime
    ) -> WeatherSnapshot: ...


# ---------------------------------------------------------------- open-meteo


class OpenMeteoWeatherSource:
    """Real WeatherSource against Open-Meteo (keyless public API).

    One request serves everything: hourly precipitation + temperature with
    past_days=2 / forecast_days=2 in UTC. Timeout 10s, one retry. A session
    is created per fetch — the 30-minute cache makes connection reuse moot.
    """

    def __init__(self, url: str = OPEN_METEO_URL) -> None:
        self._url = url

    async def fetch(
        self, latitude: float, longitude: float, now: datetime
    ) -> WeatherSnapshot:
        last_err: Exception | None = None
        for _attempt in range(2):  # one retry per spec
            try:
                data = await self._request(latitude, longitude)
                return parse_open_meteo(data, now)
            except Exception as err:  # noqa: BLE001 — any failure means retry
                last_err = err
        raise RuntimeError(f"open-meteo fetch failed: {last_err}")

    async def _request(self, latitude: float, longitude: float) -> dict:
        import aiohttp

        params = {
            "latitude": f"{latitude}",
            "longitude": f"{longitude}",
            "hourly": "precipitation,temperature_2m",
            "past_days": "2",
            "forecast_days": "3",  # M4: extended so 48h-ahead predictions
            # always have next6(T)/past24(T) coverage for occurrences near
            # the end of the forecast horizon.
            "timezone": "UTC",
        }
        timeout = aiohttp.ClientTimeout(total=FETCH_TIMEOUT_SECONDS)
        async with (
            aiohttp.ClientSession(timeout=timeout) as session,
            session.get(self._url, params=params) as resp,
        ):
            resp.raise_for_status()
            return await resp.json()


def parse_open_meteo(data: dict, now: datetime) -> WeatherSnapshot:
    """Reduce an Open-Meteo hourly payload to the M3 snapshot.

    Hourly buckets are labeled with their starting instant (UTC because we
    request timezone=UTC). past24 sums buckets in (now-24h, now]; next6 sums
    buckets in (now, now+6h]; current temperature is the newest bucket at or
    before now. None values (missing data) count as 0 mm / are skipped.
    """
    hourly = data["hourly"]
    times = [
        datetime.fromisoformat(t).replace(tzinfo=UTC) for t in hourly["time"]
    ]
    precipitation = hourly["precipitation"]
    temperature = hourly["temperature_2m"]
    if not (len(times) == len(precipitation) == len(temperature)):
        raise ValueError("open-meteo hourly arrays disagree in length")

    now = now.astimezone(UTC)
    past_start = now - timedelta(hours=LOOKBACK_HOURS)
    ahead_end = now + timedelta(hours=LOOKAHEAD_HOURS)
    past24 = 0.0
    next6 = 0.0
    current_temp: float | None = None
    for t, mm, temp in zip(times, precipitation, temperature, strict=True):
        if past_start < t <= now:
            past24 += mm or 0.0
        elif now < t <= ahead_end:
            next6 += mm or 0.0
        if t <= now and temp is not None:
            current_temp = temp  # newest reading at or before now wins
    if current_temp is None:
        raise ValueError("open-meteo payload has no current temperature")
    # M4: retain the full past+forecast series (unused by the M3 aggregates
    # above, computed separately here so the existing loop/logic is
    # untouched) so forecast predictions can compute window sums at
    # arbitrary future occurrence times.
    hourly = tuple(
        HourlyBucket(time=t, precip_mm=mm or 0.0, temp_c=temp)
        for t, mm, temp in zip(times, precipitation, temperature, strict=True)
    )
    return WeatherSnapshot(
        fetched_at=now,
        past24_mm=round(past24, 2),
        next6_mm=round(next6, 2),
        current_temp_c=current_temp,
        hourly=hourly,
    )


# --------------------------------------------------------------------- gate


class WeatherGate:
    """Owns the settings mirror + snapshot cache and renders skip decisions.

    The scheduler refreshes settings on its existing NOTIFY/15s-poll cycle
    (M3.E6) and calls evaluate() at fire time, AFTER the rain-delay check.
    evaluate() never raises: every internal failure degrades to "water with
    a note" (M3.E2).
    """

    def __init__(
        self,
        source: WeatherSource,
        cache_seconds: float = CACHE_SECONDS,
        stale_seconds: float = STALE_SECONDS,
    ) -> None:
        self._source = source
        self._cache_seconds = cache_seconds
        self._stale_seconds = stale_seconds
        self.settings: WeatherSettings | None = None
        self.snapshot: WeatherSnapshot | None = None

    def update_settings(self, settings: WeatherSettings | None) -> None:
        """Adopt the freshest settings row. Any change (updated_at included)
        invalidates the snapshot so the next evaluation refetches (M3.E5)."""
        if settings != self.settings:
            if self.settings is not None:
                self.snapshot = None
            self.settings = settings

    async def evaluate(self, now: datetime) -> WeatherDecision:
        settings = self.settings
        if settings is None or not settings.enabled:
            return WeatherDecision(skip=False, note=None)
        if settings.latitude is None or settings.longitude is None:
            return WeatherDecision(
                skip=False, note="no weather data (location not configured)"
            )
        snapshot = self.snapshot
        if (
            snapshot is None
            or (now - snapshot.fetched_at).total_seconds() >= self._cache_seconds
        ):
            try:
                snapshot = await self._source.fetch(
                    settings.latitude, settings.longitude, now
                )
                self.snapshot = snapshot
            except Exception as err:
                logger.warning("weather fetch failed (%s); using cache if fresh", err)
        if snapshot is None:
            return WeatherDecision(skip=False, note="no weather data (fetch failed)")
        if (now - snapshot.fetched_at).total_seconds() > self._stale_seconds:
            return WeatherDecision(
                skip=False, note="no weather data (snapshot older than 2h)"
            )
        return _decide(settings, snapshot)

    def status_weather(self) -> dict | None:
        """GET /api/status `weather` addition: null when disabled or never
        fetched, else the cached snapshot values (M3 status contract)."""
        settings, snapshot = self.settings, self.snapshot
        if settings is None or not settings.enabled or snapshot is None:
            return None
        return {
            "fetched_at": snapshot.fetched_at.isoformat(),
            "past24_mm": snapshot.past24_mm,
            "next6_mm": snapshot.next6_mm,
            "current_temp_c": snapshot.current_temp_c,
            "enabled": True,
        }


def _fmt(value: float) -> str:
    """'9.2', '6.0', '-2.1' — one decimal unless more are needed (values in
    notes are verbatim, so 5.25 stays '5.25', never rounded away)."""
    return f"{value:.1f}" if round(value, 1) == value else f"{value:g}"


def _decide(settings: WeatherSettings, snap: WeatherSnapshot) -> WeatherDecision:
    """Threshold comparison: >= for lookback/lookahead, <= for freeze (M3.E1).
    The first matching rule (spec order) names the skip; values verbatim."""
    if snap.past24_mm >= settings.rain_lookback_mm:
        return WeatherDecision(
            skip=True,
            note=f"rain {_fmt(snap.past24_mm)}mm in last 24h"
            f" (threshold {_fmt(settings.rain_lookback_mm)})",
        )
    if snap.next6_mm >= settings.forecast_lookahead_mm:
        return WeatherDecision(
            skip=True,
            note=f"forecast {_fmt(snap.next6_mm)}mm next 6h"
            f" (threshold {_fmt(settings.forecast_lookahead_mm)})",
        )
    if snap.current_temp_c <= settings.freeze_temp_c:
        return WeatherDecision(
            skip=True,
            note=f"freeze guard: {_fmt(snap.current_temp_c)}°C"
            f" (threshold {_fmt(settings.freeze_temp_c)})",
        )
    return WeatherDecision(skip=False, note=None)


def classify_conditions(
    settings: WeatherSettings, snap: WeatherSnapshot
) -> tuple[str | None, str | None]:
    """M4: same three rules, same order, same thresholds/operators and note
    wording as `_decide` above — but tags WHICH rule fired ("rain" /
    "forecast" / "freeze" / None) rather than a bare skip/no-skip, which is
    what forecast predictions need to report skip_rain vs skip_forecast vs
    skip_freeze. Deliberately kept separate from `_decide` (duplicated
    comparisons instead of calling it) so the M3 skip-decision code path is
    byte-for-byte untouched (M4 spec E5)."""
    if snap.past24_mm >= settings.rain_lookback_mm:
        return "rain", (
            f"rain {_fmt(snap.past24_mm)}mm in last 24h"
            f" (threshold {_fmt(settings.rain_lookback_mm)})"
        )
    if snap.next6_mm >= settings.forecast_lookahead_mm:
        return "forecast", (
            f"forecast {_fmt(snap.next6_mm)}mm next 6h"
            f" (threshold {_fmt(settings.forecast_lookahead_mm)})"
        )
    if snap.current_temp_c <= settings.freeze_temp_c:
        return "freeze", (
            f"freeze guard: {_fmt(snap.current_temp_c)}°C"
            f" (threshold {_fmt(settings.freeze_temp_c)})"
        )
    return None, None
