"""RainbirdService — sole owner of all communication with the LNK WiFi module.

The module is single-client and crashes under concurrent access, so every call
funnels through one asyncio.Lock with >=100ms enforced spacing between calls
(NFR N1). Nothing else in the app may talk to the controller.
"""

import asyncio
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import aiohttp
from pyrainbird.exceptions import RainbirdApiException

from .models import ControllerInfo, StatusResponse, Zone
from .zone_names import ZoneNameStore

logger = logging.getLogger(__name__)

MIN_CALL_SPACING_SECONDS = 0.1

# The real ESP-Me can keep reporting a zone inactive for a poll or two right
# after irrigate_zone returns (module lag). Do not evict a tracked run on an
# inactive poll until it is at least this old or has been seen active once.
RUN_STARTUP_GRACE_SECONDS = 15
# Backstop: a run this far past its requested duration is stale and dropped.
RUN_HARD_EXPIRY_SLACK_SECONDS = 60


class ControllerUnreachableError(Exception):
    """The module did not respond (powered off, network, or protocol error)."""


class UnknownZoneError(Exception):
    """Zone id is not among the controller's available stations."""


class Controller(Protocol):
    """The subset of pyrainbird's AsyncRainbirdController that we use."""

    async def get_model_and_version(self) -> Any: ...
    async def get_serial_number(self) -> str: ...
    async def get_available_stations(self) -> Any: ...
    async def get_zone_states(self) -> Any: ...
    async def get_rain_sensor_state(self) -> bool: ...
    async def get_rain_delay(self) -> int: ...
    async def irrigate_zone(self, zone: int, minutes: int) -> None: ...
    async def stop_irrigation(self) -> None: ...
    async def set_rain_delay(self, days: int) -> None: ...


@dataclass
class _ZoneRun:
    """A zone start issued through this API, used to estimate time remaining."""

    zone_id: int
    started_at: float  # time.monotonic()
    duration_seconds: int
    # True once any status poll has reported the zone active. Until then the
    # run is in its startup grace period (see RUN_STARTUP_GRACE_SECONDS).
    observed_active: bool = False


class RainbirdService:
    def __init__(
        self,
        host: str,
        password: str,
        zone_names: ZoneNameStore,
        controller_factory: Callable[[], Controller] | None = None,
    ) -> None:
        self._host = host
        self._password = password
        self._zone_names = zone_names
        self._controller_factory = controller_factory
        self._controller: Controller | None = None
        self._session: aiohttp.ClientSession | None = None

        # N1: single in-flight module call, paced.
        self._lock = asyncio.Lock()
        self._last_call_end = -float("inf")

        # Static controller info, cached after first successful fetch.
        self._controller_info: ControllerInfo | None = None
        self._available_zones: list[int] | None = None

        # Backend-tracked zone starts (controller does not report remaining time).
        self._runs: dict[int, _ZoneRun] = {}

        # Last-known-status cache for the unreachable case.
        self._status_cache: StatusResponse | None = None
        self._cached_at: datetime | None = None

    # ------------------------------------------------------------------ core

    def _get_controller(self) -> Controller:
        if self._controller is None:
            if self._controller_factory is not None:
                self._controller = self._controller_factory()
            else:
                from pyrainbird.async_client import CreateController

                self._session = aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(total=15)
                )
                self._controller = CreateController(
                    self._session, self._host, self._password
                )
        return self._controller

    async def _call(self, method: str, *args: Any) -> Any:
        """Invoke one controller command, serialized and paced (NFR N1)."""
        controller = self._get_controller()
        async with self._lock:
            wait = MIN_CALL_SPACING_SECONDS - (time.monotonic() - self._last_call_end)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                return await getattr(controller, method)(*args)
            except (RainbirdApiException, aiohttp.ClientError, TimeoutError, OSError) as err:
                logger.warning("controller call %s failed: %s", method, err)
                raise ControllerUnreachableError(str(err)) from err
            finally:
                self._last_call_end = time.monotonic()

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    # ---------------------------------------------------------------- static

    async def _ensure_static(self) -> tuple[ControllerInfo, list[int]]:
        """Fetch and cache model/firmware/serial and available stations."""
        if self._controller_info is None:
            mv = await self._call("get_model_and_version")
            serial = await self._call("get_serial_number")
            self._controller_info = ControllerInfo(
                model=mv.model_name,
                firmware=f"{mv.major}.{mv.minor}",
                serial=str(serial),
            )
        if self._available_zones is None:
            stations = await self._call("get_available_stations")
            self._available_zones = sorted(stations.active_set)
        return self._controller_info, self._available_zones

    # ------------------------------------------------------------- remaining

    def _remaining_seconds(self, zone_id: int) -> int | None:
        """Countdown for a run tracked by this API; None when untracked
        (started by the physical dial, or already pruned)."""
        run = self._runs.get(zone_id)
        if run is None:
            return None
        remaining = run.duration_seconds - (time.monotonic() - run.started_at)
        return max(0, round(remaining))

    def _prune_runs(self, active: set[int]) -> None:
        """Reconcile tracked runs against one status poll's active set."""
        now = time.monotonic()
        for zone_id, run in list(self._runs.items()):
            age = now - run.started_at
            expired = age > run.duration_seconds + RUN_HARD_EXPIRY_SLACK_SECONDS
            if zone_id in active:
                if expired and not run.observed_active:
                    # Hard expiry: a run never once seen active that is now
                    # past duration + slack is stale — whatever is running
                    # was not started by this call. Do not trust it.
                    del self._runs[zone_id]
                else:
                    run.observed_active = True
                continue
            # Zone not reported active this poll:
            if run.observed_active:
                del self._runs[zone_id]  # run genuinely ended
            elif active:
                del self._runs[zone_id]  # another zone took over (switch)
            elif age >= RUN_STARTUP_GRACE_SECONDS or expired:
                del self._runs[zone_id]  # grace over / stale — evict
            # else: within startup grace, never yet observed active — the
            # ESP-Me lags right after irrigate_zone; keep the run.

    def _active_zones(self, states: Any) -> list[int]:
        zones = self._available_zones or []
        active = [z for z in zones if states.active(z)]
        self._prune_runs(set(active))
        return active

    # ----------------------------------------------------------------- status

    async def get_status(self) -> StatusResponse:
        try:
            info, zone_ids = await self._ensure_static()
            states = await self._call("get_zone_states")
            rain_sensor = await self._call("get_rain_sensor_state")
            rain_delay = await self._call("get_rain_delay")
        except ControllerUnreachableError:
            if self._status_cache is None:
                raise
            return self._cached_status()

        active = set(self._active_zones(states))
        status = StatusResponse(
            controller=info,
            zones=[
                Zone(
                    id=zone_id,
                    name=self._zone_names.get(zone_id),
                    active=zone_id in active,
                    remaining_seconds=self._remaining_seconds(zone_id),
                )
                for zone_id in zone_ids
            ],
            rain_sensor_active=bool(rain_sensor),
            rain_delay_days=int(rain_delay),
            reachable=True,
            cached_at=None,
        )
        self._status_cache = status.model_copy(deep=True)
        self._cached_at = datetime.now(UTC)
        return status

    def _cached_status(self) -> StatusResponse:
        assert self._status_cache is not None and self._cached_at is not None
        status = self._status_cache.model_copy(deep=True)
        status.reachable = False
        status.cached_at = self._cached_at.isoformat()
        for zone in status.zones:  # names are local — always current
            zone.name = self._zone_names.get(zone.id)
        return status

    # ------------------------------------------------------------------ zones

    async def known_zones(self) -> list[int]:
        """Controller station ids, fetched once and cached (may raise
        ControllerUnreachableError on the first call)."""
        _, zone_ids = await self._ensure_static()
        return zone_ids

    async def start_zone(self, zone_id: int, minutes: int) -> list[int]:
        if zone_id not in await self.known_zones():
            raise UnknownZoneError(zone_id)
        await self._call("irrigate_zone", zone_id, minutes)
        # The controller runs one zone at a time: starting B while A runs switches.
        self._runs = {
            zone_id: _ZoneRun(
                zone_id=zone_id,
                started_at=time.monotonic(),
                duration_seconds=minutes * 60,
            )
        }
        states = await self._call("get_zone_states")
        return self._active_zones(states)

    async def stop_all(self) -> list[int]:
        await self._call("stop_irrigation")
        self._runs.clear()
        states = await self._call("get_zone_states")
        return self._active_zones(states)

    async def rename_zone(self, zone_id: int, name: str) -> Zone:
        if zone_id not in await self.known_zones():
            raise UnknownZoneError(zone_id)
        self._zone_names.set(zone_id, name)
        try:
            states = await self._call("get_zone_states")
            active = zone_id in self._active_zones(states)
            remaining = self._remaining_seconds(zone_id)
        except ControllerUnreachableError:
            # The rename itself is local and already persisted; fall back to
            # the last-known state rather than failing the request.
            cached = None
            if self._status_cache is not None:
                cached = next(
                    (z for z in self._status_cache.zones if z.id == zone_id), None
                )
            active = cached.active if cached else False
            remaining = cached.remaining_seconds if cached else None
        return Zone(id=zone_id, name=name, active=active, remaining_seconds=remaining)

    # ------------------------------------------------------------- rain delay

    async def get_rain_delay(self) -> int:
        return int(await self._call("get_rain_delay"))

    async def set_rain_delay(self, days: int) -> int:
        await self._call("set_rain_delay", days)
        return days
