"""Postgres persistence for the scheduler (M2 shared schema).

The web app owns and migrates the schema; the executor reads programs /
program_steps / zones / run_requests and writes run_requests.claimed_at,
program_runs and program_run_steps. Pool pattern mirrors
zone_config.AsyncpgZoneConfigSource: lazy creation, small, bounded timeouts.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .scheduler import Program, ProgramStep, RunRequest, ZoneRow
from .weather import WeatherSettings

logger = logging.getLogger(__name__)

DB_TIMEOUT_SECONDS = 5.0
NOTIFY_CHANNEL = "sprinkler_events"


class AsyncpgSchedulerStore:
    """SchedulerStore backed by Postgres via asyncpg."""

    def __init__(self, dsn: str, timeout: float = DB_TIMEOUT_SECONDS) -> None:
        self._dsn = dsn
        self._timeout = timeout
        self._pool: Any = None
        self._pool_lock = asyncio.Lock()
        self.listening = False  # observability (tests wait on this)

    async def _get_pool(self) -> Any:
        async with self._pool_lock:
            if self._pool is None:
                import asyncpg

                self._pool = await asyncpg.create_pool(
                    self._dsn,
                    min_size=0,
                    max_size=2,
                    timeout=self._timeout,
                    command_timeout=self._timeout,
                )
            return self._pool

    # ---------------------------------------------------------------- reads

    async def fetch_programs(self) -> list[Program]:
        pool = await self._get_pool()
        program_rows = await pool.fetch(
            "SELECT id, name, enabled, start_times, day_type, days_of_week,"
            " interval_days, anchor_date, respect_rain_delay, updated_at"
            " FROM programs"
        )
        step_rows = await pool.fetch(
            "SELECT program_id, position, zone_id, minutes"
            " FROM program_steps ORDER BY program_id, position"
        )
        steps: dict[int, list[ProgramStep]] = {}
        for row in step_rows:
            steps.setdefault(row["program_id"], []).append(
                ProgramStep(
                    position=row["position"],
                    zone_id=row["zone_id"],
                    minutes=row["minutes"],
                )
            )
        return [
            Program(
                id=row["id"],
                name=row["name"],
                enabled=row["enabled"],
                start_times=tuple(sorted(row["start_times"])),
                day_type=row["day_type"],
                days_of_week=(
                    tuple(row["days_of_week"])
                    if row["days_of_week"] is not None
                    else None
                ),
                interval_days=row["interval_days"],
                anchor_date=row["anchor_date"],
                respect_rain_delay=row["respect_rain_delay"],
                steps=tuple(steps.get(row["id"], [])),
                updated_at=row["updated_at"].astimezone(UTC),
            )
            for row in program_rows
        ]

    async def fetch_zones(self) -> dict[int, ZoneRow]:
        pool = await self._get_pool()
        rows = await pool.fetch("SELECT id, name, enabled FROM zones")
        return {
            row["id"]: ZoneRow(
                id=row["id"], name=row["name"], enabled=row["enabled"]
            )
            for row in rows
        }

    async def recent_run_keys(self, since: datetime) -> set[tuple[int, datetime]]:
        pool = await self._get_pool()
        rows = await pool.fetch(
            "SELECT program_id, scheduled_for FROM program_runs"
            " WHERE program_id IS NOT NULL AND scheduled_for IS NOT NULL"
            " AND scheduled_for >= $1",
            since,
        )
        return {
            (row["program_id"], row["scheduled_for"].astimezone(UTC))
            for row in rows
        }

    async def fetch_weather_settings(self) -> WeatherSettings | None:
        """M3: the singleton weather_settings row (web-next owns the DDL).
        Returns None when the row is absent; raises on connection trouble —
        the scheduler keeps its previous settings in that case."""
        pool = await self._get_pool()
        row = await pool.fetchrow(
            "SELECT enabled, latitude, longitude, rain_lookback_mm,"
            " forecast_probability, forecast_lookahead_mm, freeze_temp_c,"
            " updated_at"
            " FROM weather_settings WHERE id = 1"
        )
        if row is None:
            return None
        return WeatherSettings(
            enabled=row["enabled"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            rain_lookback_mm=row["rain_lookback_mm"],
            forecast_probability=row["forecast_probability"],
            forecast_lookahead_mm=row["forecast_lookahead_mm"],
            freeze_temp_c=row["freeze_temp_c"],
            updated_at=row["updated_at"].astimezone(UTC),
        )

    # --------------------------------------------------------------- claims

    async def claim_run_requests(self) -> list[RunRequest]:
        pool = await self._get_pool()
        rows = await pool.fetch(
            "SELECT id, program_id, requested_by FROM run_requests"
            " WHERE claimed_at IS NULL ORDER BY created_at, id"
        )
        if not rows:
            return []
        await pool.execute(
            "UPDATE run_requests SET claimed_at = now() WHERE id = ANY($1::int[])",
            [row["id"] for row in rows],
        )
        return [
            RunRequest(
                id=row["id"],
                program_id=row["program_id"],
                requested_by=row["requested_by"],
            )
            for row in rows
        ]

    # --------------------------------------------------------------- writes

    async def insert_terminal_run(
        self,
        *,
        program_id: int,
        program_name: str,
        scheduled_for: datetime | None,
        initiator: str,
        status: str,
        note: str | None,
        now: datetime,
    ) -> int:
        pool = await self._get_pool()
        return await pool.fetchval(
            "INSERT INTO program_runs"
            " (program_id, program_name, scheduled_for, initiator, status,"
            "  finished_at, note)"
            " VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            program_id,
            program_name,
            scheduled_for,
            initiator,
            status,
            now,
            note,
        )

    async def insert_running_run(
        self,
        *,
        program_id: int,
        program_name: str,
        scheduled_for: datetime | None,
        initiator: str,
        steps: list[tuple[int, int, str, int]],
        now: datetime,
    ) -> int:
        pool = await self._get_pool()
        async with pool.acquire() as conn, conn.transaction():
            run_id = await conn.fetchval(
                "INSERT INTO program_runs"
                " (program_id, program_name, scheduled_for, initiator, status,"
                "  started_at)"
                " VALUES ($1, $2, $3, $4, 'running', $5) RETURNING id",
                program_id,
                program_name,
                scheduled_for,
                initiator,
                now,
            )
            await conn.executemany(
                "INSERT INTO program_run_steps"
                " (run_id, position, zone_id, zone_name, planned_minutes)"
                " VALUES ($1, $2, $3, $4, $5)",
                [
                    (run_id, position, zone_id, zone_name, minutes)
                    for position, zone_id, zone_name, minutes in steps
                ],
            )
        return run_id

    async def mark_step_started(
        self, run_id: int, position: int, now: datetime
    ) -> None:
        pool = await self._get_pool()
        await pool.execute(
            "UPDATE program_run_steps SET started_at = $3"
            " WHERE run_id = $1 AND position = $2",
            run_id,
            position,
            now,
        )

    async def mark_step_finished(
        self, run_id: int, position: int, outcome: str, finished_at: datetime | None
    ) -> None:
        pool = await self._get_pool()
        await pool.execute(
            "UPDATE program_run_steps SET outcome = $3, finished_at = $4"
            " WHERE run_id = $1 AND position = $2",
            run_id,
            position,
            outcome,
            finished_at,
        )

    async def finish_run(
        self, run_id: int, status: str, note: str | None, now: datetime
    ) -> None:
        pool = await self._get_pool()
        await pool.execute(
            "UPDATE program_runs SET status = $2, note = $3, finished_at = $4"
            " WHERE id = $1",
            run_id,
            status,
            note,
            now,
        )

    async def finalize_orphans(self, now: datetime) -> int:
        """M2.E9: finalize 'running' rows left behind by a crash/restart."""
        pool = await self._get_pool()
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute(
                "UPDATE program_run_steps SET outcome = 'cancelled',"
                " finished_at = $1"
                " WHERE started_at IS NOT NULL AND finished_at IS NULL"
                " AND outcome IS NULL"
                " AND run_id IN (SELECT id FROM program_runs WHERE status = 'running')",
                now,
            )
            rows = await conn.fetch(
                "UPDATE program_runs SET status = 'cancelled', finished_at = $1,"
                " note = 'cancelled: executor restarted mid-run'"
                " WHERE status = 'running' RETURNING id",
                now,
            )
        return len(rows)

    # --------------------------------------------------------------- listen

    async def listen(self, on_event: Callable[[], None]) -> None:
        """Hold a LISTEN connection; returns when the connection drops (the
        scheduler retries). NOTIFY is an optimization, never a dependency."""
        import asyncpg

        conn = await asyncpg.connect(self._dsn, timeout=self._timeout)
        try:

            def _callback(*_args: Any) -> None:
                on_event()

            await conn.add_listener(NOTIFY_CHANNEL, _callback)
            logger.info("listening on %s", NOTIFY_CHANNEL)
            self.listening = True
            while not conn.is_closed():
                await asyncio.sleep(1.0)
        finally:
            self.listening = False
            try:
                await conn.close()
            except Exception:
                pass

    async def close(self) -> None:
        async with self._pool_lock:
            if self._pool is not None:
                await self._pool.close()
                self._pool = None
