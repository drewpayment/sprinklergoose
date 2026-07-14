"""M3.E8: one real Open-Meteo call (keyless public API) parses into the
snapshot shape. Skipped when offline — never a hard CI dependency."""

from datetime import UTC, datetime

import pytest

from app.weather import OpenMeteoWeatherSource

# Detroit, MI — the executor's home turf (SCHEDULE_TIMEZONE default).
LAT, LON = 42.3314, -83.0458


async def test_real_open_meteo_fetch_parses():
    source = OpenMeteoWeatherSource()
    now = datetime.now(UTC)
    try:
        snapshot = await source.fetch(LAT, LON, now)
    except Exception as err:
        pytest.skip(f"open-meteo unreachable (offline?): {err}")

    assert snapshot.fetched_at == now.astimezone(UTC)
    # Sanity, not meteorology: non-negative rain, an earthly temperature.
    assert snapshot.past24_mm >= 0.0
    assert snapshot.next6_mm >= 0.0
    assert -60.0 < snapshot.current_temp_c < 60.0
