"""Postgres persistence for the scheduler (M2 shared schema).

The web app owns and migrates the schema; the executor reads programs /
program_steps / zones / run_requests and writes run_requests.claimed_at,
program_runs and program_run_steps. Pool pattern mirrors
zone_config.AsyncpgZoneConfigSource: lazy creation, small, bounded timeouts.

Every operation goes through _op(), which enforces a hard wall-clock bound
and discards the pool on timeout. asyncpg's `command_timeout` only bounds a
statement on a live connection — it does not bound Pool.acquire(), and a
server killed without closing its sockets (SIGKILL under an NFS stall) can
leave every pooled connection wedged so all later acquires block forever.
The scheduler loop must never be able to hang on this store.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from .scheduler import Program, ProgramStep, RunRequest, ZoneRow
from .weather import WeatherSettings

logger = logging.getLogger(__name__)

DB_TIMEOUT_SECONDS = 5.0
# An operation may hold a connection across several bounded statements
# (acquire + inserts + commit), so its wall-clock budget is a multiple of
# the per-statement timeout.
OP_TIMEOUT_MULTIPLIER = 3
NOTIFY_CHANNEL = "sprinkler_events"


def _decode_jsonb(raw: Any) -> Any:
    """asyncpg hands back jsonb columns as raw JSON text (no codec is
    registered). None passes through; unparseable text decodes to None so
    a malformed run_requests.steps value is treated as malformed rather
    than raising out of the read path."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        return raw  # already decoded (e.g. a codec is registered later)
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


class AsyncpgSchedulerStore:
    """SchedulerStore backed by Postgres via asyncpg."""

    def __init__(self, dsn: str, timeout: float = DB_TIMEOUT_SECONDS) -> None:
        self._dsn = dsn
        self._timeout = timeout
        self._op_timeout = timeout * OP_TIMEOUT_MULTIPLIER
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

    async def _op(self, label: str, op: Callable[[Any], Any]) -> Any:
        """Run one pool operation with a hard wall-clock bound.

        On timeout the stuck task is abandoned rather than awaited:
        cancelling asyncpg mid-statement opens a *new* connection to the
        server to deliver the cancel request, which hangs just as hard when
        the server is gone. pool.terminate() closes every socket, which
        unsticks the abandoned task, and dropping the pool reference means
        the next call builds a fresh pool.
        """
        pool = await asyncio.wait_for(self._get_pool(), timeout=self._timeout)
        task = asyncio.ensure_future(op(pool))
        done, pending = await asyncio.wait({task}, timeout=self._op_timeout)
        if pending:
            task.cancel()
            await self._discard_pool(pool)
            raise TimeoutError(
                f"{label} timed out after {self._op_timeout:g}s; pool discarded"
            )
        return task.result()

    async def _discard_pool(self, pool: Any) -> None:
        async with self._pool_lock:
            if self._pool is pool:
                self._pool = None
        logger.warning("discarding wedged asyncpg pool")
        try:
            pool.terminate()
        except Exception:
            pass

    # ---------------------------------------------------------------- reads

    async def fetch_programs(self) -> list[Program]:
        async def op(pool: Any) -> tuple[Any, Any]:
            program_rows = await pool.fetch(
                "SELECT id, name, enabled, start_times, day_type, days_of_week,"
                " interval_days, anchor_date, respect_rain_delay, updated_at"
                " FROM programs"
            )
            step_rows = await pool.fetch(
                "SELECT program_id, position, zone_id, minutes"
                " FROM program_steps ORDER BY program_id, position"
            )
            return program_rows, step_rows

        program_rows, step_rows = await self._op("fetch_programs", op)
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
        rows = await self._op(
            "fetch_zones",
            lambda pool: pool.fetch("SELECT id, name, enabled FROM zones"),
        )
        return {
            row["id"]: ZoneRow(
                id=row["id"], name=row["name"], enabled=row["enabled"]
            )
            for row in rows
        }

    async def recent_run_keys(self, since: datetime) -> set[tuple[int, datetime]]:
        rows = await self._op(
            "recent_run_keys",
            lambda pool: pool.fetch(
                "SELECT program_id, scheduled_for FROM program_runs"
                " WHERE program_id IS NOT NULL AND scheduled_for IS NOT NULL"
                " AND scheduled_for >= $1",
                since,
            ),
        )
        return {
            (row["program_id"], row["scheduled_for"].astimezone(UTC))
            for row in rows
        }

    async def fetch_weather_settings(self) -> WeatherSettings | None:
        """M3: the singleton weather_settings row (web-next owns the DDL).
        Returns None when the row is absent; raises on connection trouble —
        the scheduler keeps its previous settings in that case."""
        row = await self._op(
            "fetch_weather_settings",
            lambda pool: pool.fetchrow(
                "SELECT enabled, latitude, longitude, rain_lookback_mm,"
                " forecast_probability, forecast_lookahead_mm, freeze_temp_c,"
                " updated_at"
                " FROM weather_settings WHERE id = 1"
            ),
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
        async def op(pool: Any) -> Any:
            rows = await pool.fetch(
                "SELECT id, program_id, requested_by, steps FROM run_requests"
                " WHERE claimed_at IS NULL ORDER BY created_at, id"
            )
            if not rows:
                return []
            await pool.execute(
                "UPDATE run_requests SET claimed_at = now()"
                " WHERE id = ANY($1::int[])",
                [row["id"] for row in rows],
            )
            return rows

        rows = await self._op("claim_run_requests", op)
        if not rows:
            return []
        return [
            RunRequest(
                id=row["id"],
                program_id=row["program_id"],
                requested_by=row["requested_by"],
                # M3.Q: asyncpg returns jsonb as raw text by default; decode
                # it here so the scheduler always deals in Python values.
                # A malformed/non-JSON value decodes to None, which
                # parse_quick_run_steps() rejects like any other malformed
                # payload rather than raising.
                steps=_decode_jsonb(row["steps"]),
            )
            for row in rows
        ]

    # --------------------------------------------------------------- writes

    async def insert_terminal_run(
        self,
        *,
        program_id: int | None,
        program_name: str,
        scheduled_for: datetime | None,
        initiator: str,
        status: str,
        note: str | None,
        now: datetime,
    ) -> int:
        return await self._op(
            "insert_terminal_run",
            lambda pool: pool.fetchval(
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
            ),
        )

    async def insert_running_run(
        self,
        *,
        program_id: int | None,
        program_name: str,
        scheduled_for: datetime | None,
        initiator: str,
        steps: list[tuple[int, int, str, int]],
        now: datetime,
    ) -> int:
        async def op(pool: Any) -> int:
            async with pool.acquire() as conn, conn.transaction():
                run_id = await conn.fetchval(
                    "INSERT INTO program_runs"
                    " (program_id, program_name, scheduled_for, initiator,"
                    "  status, started_at)"
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

        return await self._op("insert_running_run", op)

    async def mark_step_started(
        self, run_id: int, position: int, now: datetime
    ) -> None:
        await self._op(
            "mark_step_started",
            lambda pool: pool.execute(
                "UPDATE program_run_steps SET started_at = $3"
                " WHERE run_id = $1 AND position = $2",
                run_id,
                position,
                now,
            ),
        )

    async def mark_step_finished(
        self, run_id: int, position: int, outcome: str, finished_at: datetime | None
    ) -> None:
        await self._op(
            "mark_step_finished",
            lambda pool: pool.execute(
                "UPDATE program_run_steps SET outcome = $3, finished_at = $4"
                " WHERE run_id = $1 AND position = $2",
                run_id,
                position,
                outcome,
                finished_at,
            ),
        )

    async def finish_run(
        self, run_id: int, status: str, note: str | None, now: datetime
    ) -> None:
        await self._op(
            "finish_run",
            lambda pool: pool.execute(
                "UPDATE program_runs SET status = $2, note = $3, finished_at = $4"
                " WHERE id = $1",
                run_id,
                status,
                note,
                now,
            ),
        )

    async def finalize_orphans(self, now: datetime) -> int:
        """M2.E9: finalize 'running' rows left behind by a crash/restart."""

        async def op(pool: Any) -> int:
            async with pool.acquire() as conn, conn.transaction():
                await conn.execute(
                    "UPDATE program_run_steps SET outcome = 'cancelled',"
                    " finished_at = $1"
                    " WHERE started_at IS NOT NULL AND finished_at IS NULL"
                    " AND outcome IS NULL"
                    " AND run_id IN"
                    " (SELECT id FROM program_runs WHERE status = 'running')",
                    now,
                )
                rows = await conn.fetch(
                    "UPDATE program_runs SET status = 'cancelled',"
                    " finished_at = $1,"
                    " note = 'cancelled: executor restarted mid-run'"
                    " WHERE status = 'running' RETURNING id",
                    now,
                )
                return len(rows)

        return await self._op("finalize_orphans", op)

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
