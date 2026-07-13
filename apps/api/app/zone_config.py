"""Zone enablement read from the web app's Postgres `zones` table (M1 W2).

The web app owns and migrates the table; the executor only ever READS it.
Configuration is optional: without DATABASE_URL the executor behaves exactly
as v1 (every zone enabled, no DB traffic). When configured, zone starts are
gated on `zones.enabled` through a small TTL cache with fail-safe semantics:
if the database cannot answer with data at most CACHE_TTL_SECONDS old, starts
are refused — we never water on unknown config. Status is best-effort and
falls back to the last cached snapshot when the database is unreachable.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from typing import Any, Protocol

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 5.0
DB_TIMEOUT_SECONDS = 3.0


class ZoneConfigUnavailableError(Exception):
    """The zones table could not be read (DB down, timeout, bad schema)."""


class ZoneConfigSource(Protocol):
    """Reads the zone id -> enabled mapping from wherever it lives.

    Implementations raise ZoneConfigUnavailableError on any failure.
    """

    async def fetch_enabled(self) -> dict[int, bool]: ...
    async def close(self) -> None: ...


class AsyncpgZoneConfigSource:
    """ZoneConfigSource backed by Postgres via asyncpg.

    The pool is created lazily on first use so app startup never blocks on
    the database, and a failed creation is retried on the next call.
    """

    def __init__(self, dsn: str, timeout: float = DB_TIMEOUT_SECONDS) -> None:
        self._dsn = dsn
        self._timeout = timeout
        self._pool: Any = None
        self._pool_lock = asyncio.Lock()

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

    async def fetch_enabled(self) -> dict[int, bool]:
        try:
            pool = await asyncio.wait_for(self._get_pool(), timeout=self._timeout)
            rows = await asyncio.wait_for(
                pool.fetch("SELECT id, enabled FROM zones"),
                timeout=self._timeout,
            )
        except Exception as err:
            # Fail-safe: any failure (connection refused, timeout, missing
            # table, auth) means the config is unknown.
            logger.warning("zones table read failed: %s", err)
            raise ZoneConfigUnavailableError(str(err)) from err
        return {int(row["id"]): bool(row["enabled"]) for row in rows}

    async def close(self) -> None:
        async with self._pool_lock:
            if self._pool is not None:
                await self._pool.close()
                self._pool = None


class ZoneEnablement:
    """TTL-cached view of zone enablement with fail-safe semantics.

    - `is_enabled` (the start-gate) only answers from a snapshot at most
      `ttl` seconds old; if a refresh is needed and fails, it raises —
      callers must refuse the start (503). A zone with no row in the table
      has unknown config and is treated as disabled.
    - `enabled_map` (the status annotation) never raises: it serves the
      freshest snapshot it can get, falling back to the last cached one of
      any age, or None if the table has never been read.
    """

    def __init__(
        self,
        source: ZoneConfigSource,
        ttl: float = CACHE_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._source = source
        self._ttl = ttl
        self._clock = clock
        self._snapshot: dict[int, bool] | None = None
        self._fetched_at = -float("inf")
        self._refresh_lock = asyncio.Lock()

    def _fresh(self) -> bool:
        return (
            self._snapshot is not None
            and self._clock() - self._fetched_at <= self._ttl
        )

    async def _refresh_if_stale(self) -> None:
        """Ensure the snapshot is at most `ttl` old; raise if that's impossible."""
        if self._fresh():
            return
        async with self._refresh_lock:
            if self._fresh():
                return  # another task refreshed while we waited
            self._snapshot = await self._source.fetch_enabled()
            self._fetched_at = self._clock()

    async def is_enabled(self, zone_id: int) -> bool:
        """Fail-safe enablement check for zone starts.

        Raises ZoneConfigUnavailableError when no sufficiently fresh answer
        exists (never water on unknown config).
        """
        await self._refresh_if_stale()
        assert self._snapshot is not None
        return self._snapshot.get(zone_id, False)

    async def enabled_map(self) -> dict[int, bool] | None:
        """Best-effort map for status responses. Never raises."""
        try:
            await self._refresh_if_stale()
        except ZoneConfigUnavailableError:
            if self._snapshot is not None:
                logger.warning("zones table unreachable; serving last cached enablement")
        return self._snapshot

    async def close(self) -> None:
        await self._source.close()
