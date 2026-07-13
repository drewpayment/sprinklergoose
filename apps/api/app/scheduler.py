"""M2 W1: the app-owned scheduler engine.

The scheduler reads program definitions from Postgres (shared with the web
app), computes occurrences in the executor's local timezone, and executes due
programs step-by-step through the existing RainbirdService — the N1 lock and
100ms pacing are untouched; the scheduler is just another caller.

Key invariants:

- **Dedupe / watermark**: a `program_runs` row exists for every evaluated
  occurrence (run, missed, skipped, cancelled). The rows themselves are the
  watermark — on (re)start the fired-set is derived from them, so restarts
  never double-fire (M2.E9). No parallel bookkeeping state is persisted.
- **One run at a time**: a due program while another runs joins a FIFO queue;
  duplicate occurrences of an already-queued program collapse (recorded as
  `missed` with a note); the queue is capped (overflow -> `missed` with note);
  run-now requests jump the queue but stay FIFO among themselves.
- **Cancellation**: stop-all cancels the active run (in-flight step
  `cancelled`) and clears the queue; a manual zone start cancels the active
  run first (manual always wins) and defers the queue until the manual run's
  duration elapses. The scheduler never issues hardware commands on the
  cancellation path — the endpoint that triggered it owns the hardware action.
- **Autonomy**: everything works with only Postgres running. NOTIFY
  (`sprinkler_events`) is an optimization; a 15s poll is the fallback.
- **Fail-safe**: if the database cannot be read at startup the scheduler does
  not fire anything (unknown watermark = possible double-fire). If a run
  cannot be recorded, it is not started — never water without history.

DST: program times are local wall times (SCHEDULE_TIMEZONE). A nonexistent
spring-forward time (e.g. 2:30 AM) resolves to the same UTC instant as the
pre-gap offset, i.e. the program runs at 3:30 local — documented behavior.
"""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "America/Detroit"
TICK_SECONDS = 5.0
POLL_SECONDS = 15.0
MISSED_GRACE_SECONDS = 10 * 60
QUEUE_CAP = 5
EVAL_LOOKBACK = timedelta(hours=24)
NEXT_HORIZON = timedelta(days=7)
LISTEN_RETRY_SECONDS = 5.0

INITIATOR_SCHEDULE = "schedule"

DAY_TYPE_DAYS_OF_WEEK = "days_of_week"
DAY_TYPE_INTERVAL = "interval"


# --------------------------------------------------------------------- model


@dataclass(frozen=True)
class ProgramStep:
    position: int
    zone_id: int
    minutes: int


@dataclass(frozen=True)
class Program:
    id: int
    name: str
    enabled: bool
    start_times: tuple[time, ...]
    day_type: str
    days_of_week: tuple[int, ...] | None
    interval_days: int | None
    anchor_date: date | None
    respect_rain_delay: bool
    steps: tuple[ProgramStep, ...]
    # When set, occurrences at or before this instant are never fired or
    # backfilled as missed: they predate the program's (re)configuration.
    updated_at: datetime | None = None


@dataclass(frozen=True)
class ZoneRow:
    id: int
    name: str
    enabled: bool


@dataclass(frozen=True)
class RunRequest:
    id: int
    program_id: int
    requested_by: str


@dataclass(frozen=True)
class QueueItem:
    program_id: int
    program_name: str
    scheduled_for: datetime | None  # UTC occurrence instant; None = run-now
    initiator: str  # INITIATOR_SCHEDULE or the requesting user's email


@dataclass
class ActiveRun:
    run_id: int
    program_id: int
    program_name: str
    scheduled_for: datetime | None
    total_steps: int
    step_position: int | None = None
    step_zone_id: int | None = None
    step_deadline: datetime | None = None


# ----------------------------------------------------------------- protocols


class Clock(Protocol):
    """Injectable time source so unit tests drive time deterministically."""

    def now(self) -> datetime: ...  # timezone-aware
    async def sleep(self, seconds: float) -> None: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)

    async def sleep(self, seconds: float) -> None:
        await asyncio.sleep(seconds)


class IrrigationService(Protocol):
    """The RainbirdService subset the scheduler uses (all N1-locked/paced)."""

    async def start_zone(self, zone_id: int, minutes: int) -> list[int]: ...
    async def stop_all(self) -> list[int]: ...
    async def get_rain_delay(self) -> int: ...


class SchedulerStore(Protocol):
    """Persistence per the M2 shared schema. Implementations raise on failure."""

    async def fetch_programs(self) -> list[Program]: ...
    async def fetch_zones(self) -> dict[int, ZoneRow]: ...
    async def claim_run_requests(self) -> list[RunRequest]: ...
    async def recent_run_keys(
        self, since: datetime
    ) -> set[tuple[int, datetime]]: ...
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
    ) -> int: ...
    async def insert_running_run(
        self,
        *,
        program_id: int,
        program_name: str,
        scheduled_for: datetime | None,
        initiator: str,
        steps: list[tuple[int, int, str, int]],  # (position, zone_id, zone_name, minutes)
        now: datetime,
    ) -> int: ...
    async def mark_step_started(
        self, run_id: int, position: int, now: datetime
    ) -> None: ...
    async def mark_step_finished(
        self, run_id: int, position: int, outcome: str, finished_at: datetime | None
    ) -> None: ...
    async def finish_run(
        self, run_id: int, status: str, note: str | None, now: datetime
    ) -> None: ...
    async def finalize_orphans(self, now: datetime) -> int: ...
    async def listen(self, on_event) -> None: ...  # returns on connection loss
    async def close(self) -> None: ...


# ------------------------------------------------------- occurrence calculus


def _matches_day(program: Program, day: date) -> bool:
    if program.day_type == DAY_TYPE_DAYS_OF_WEEK:
        return (
            program.days_of_week is not None
            and day.weekday() in program.days_of_week  # 0=Mon..6=Sun, both sides
        )
    if program.day_type == DAY_TYPE_INTERVAL:
        if not program.interval_days or program.anchor_date is None:
            return False
        delta = (day - program.anchor_date).days
        return delta >= 0 and delta % program.interval_days == 0
    return False


def occurrences_between(
    program: Program, start: datetime, end: datetime, tz: ZoneInfo
) -> list[datetime]:
    """Occurrence instants with start < t <= end, as aware UTC datetimes.

    Local wall times are resolved with fold=0; a nonexistent spring-forward
    time therefore lands one hour later on the clock (2:30 -> 3:30 local).
    """
    out: list[datetime] = []
    day = start.astimezone(tz).date() - timedelta(days=1)
    last = end.astimezone(tz).date() + timedelta(days=1)
    while day <= last:
        if _matches_day(program, day):
            for wall in program.start_times:
                instant = datetime.combine(day, wall, tzinfo=tz).astimezone(UTC)
                if start < instant <= end:
                    out.append(instant)
        day += timedelta(days=1)
    return sorted(out)


def next_occurrence(
    programs, now: datetime, horizon: timedelta, tz: ZoneInfo
) -> tuple[str, datetime] | None:
    """(program_name, UTC instant) of the soonest future occurrence, or None."""
    best: tuple[str, datetime] | None = None
    for program in programs:
        if not program.enabled or not program.steps:
            continue
        occs = occurrences_between(program, now, now + horizon, tz)
        if occs and (best is None or occs[0] < best[1]):
            best = (program.name, occs[0])
    return best


def _summarize(outcomes: list[str], skipped_names: list[str]) -> tuple[str, str | None]:
    failed = outcomes.count("failed")
    notes = []
    if skipped_names:
        notes.append("skipped disabled zone(s): " + ", ".join(skipped_names))
    if failed:
        notes.append(f"{failed} step(s) failed to start after retry")
    note = "; ".join(notes) or None
    if failed and failed == len(outcomes):
        return "failed", note
    if failed:
        return "partial", note
    return "completed", note


# ----------------------------------------------------------------- scheduler


class Scheduler:
    def __init__(
        self,
        store: SchedulerStore,
        service: IrrigationService,
        clock: Clock | None = None,
        timezone: str = DEFAULT_TIMEZONE,
        tick_seconds: float = TICK_SECONDS,
        poll_seconds: float = POLL_SECONDS,
        queue_cap: int = QUEUE_CAP,
        minute_seconds: float = 60.0,  # test seam: real seconds per "minute"
        lookback: timedelta = EVAL_LOOKBACK,
        horizon: timedelta = NEXT_HORIZON,
    ) -> None:
        self._store = store
        self._service = service
        self._clock: Clock = clock or SystemClock()
        self._tz = ZoneInfo(timezone)
        self._tick_seconds = tick_seconds
        self._poll_seconds = poll_seconds
        self._queue_cap = queue_cap
        self._minute_seconds = minute_seconds
        self._lookback = lookback
        self._horizon = horizon

        self._programs: dict[int, Program] = {}
        self._fired: set[tuple[int, datetime]] = set()  # derived from program_runs
        self._queue: deque[QueueItem] = deque()
        self._active: ActiveRun | None = None
        self._run_task: asyncio.Task | None = None
        self._cancel_note: str | None = None
        self._manual_until: datetime | None = None  # manual zone hold deadline

        self._ready = False  # first successful refresh done (watermark loaded)
        self._orphans_finalized = False
        self._refresh_needed = True
        self._last_refresh: datetime | None = None

        self._poke = asyncio.Event()
        self._loop_task: asyncio.Task | None = None
        self._listen_task: asyncio.Task | None = None

    # -------------------------------------------------------------- lifecycle

    async def start(self) -> None:
        if self._loop_task is not None:
            return
        self._loop_task = asyncio.create_task(self._loop(), name="scheduler-loop")
        self._listen_task = asyncio.create_task(
            self._listen_loop(), name="scheduler-listen"
        )

    async def stop(self) -> None:
        for task in (self._listen_task, self._loop_task):
            if task is not None:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        self._listen_task = self._loop_task = None
        await self.cancel_active("cancelled: executor shutting down")
        await self._store.close()

    async def _loop(self) -> None:
        while True:
            try:
                await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("scheduler tick failed")
            try:
                await asyncio.wait_for(self._poke.wait(), timeout=self._tick_seconds)
            except TimeoutError:
                pass
            self._poke.clear()

    async def _listen_loop(self) -> None:
        while True:
            try:
                await self._store.listen(self._on_notify)
            except asyncio.CancelledError:
                raise
            except Exception as err:
                logger.warning("LISTEN sprinkler_events failed (%s); retrying", err)
            await asyncio.sleep(LISTEN_RETRY_SECONDS)

    def _on_notify(self) -> None:
        self._refresh_needed = True
        self._poke.set()

    # ------------------------------------------------------------------- tick

    async def tick(self) -> None:
        """One scheduler cycle. Driven by the loop every <=5s; unit tests call
        it directly with a fake clock."""
        now = self._clock.now()
        if not self._orphans_finalized:
            try:
                count = await self._store.finalize_orphans(now)
            except Exception as err:
                logger.warning("orphan finalization failed (%s); will retry", err)
                return
            self._orphans_finalized = True
            if count:
                logger.warning(
                    "finalized %d orphaned 'running' run(s) as cancelled", count
                )
        if (
            self._refresh_needed
            or self._last_refresh is None
            or (now - self._last_refresh).total_seconds() >= self._poll_seconds
        ):
            try:
                await self._refresh(now)
                self._ready = True
            except Exception as err:
                logger.warning("scheduler refresh failed (%s); using cached config", err)
        if not self._ready:
            return  # never fire before the watermark has been loaded
        await self._evaluate(now)
        await self._pump(now)

    async def _refresh(self, now: datetime) -> None:
        programs = await self._store.fetch_programs()
        self._programs = {p.id: p for p in programs}
        window_start = now - self._lookback
        keys = await self._store.recent_run_keys(window_start)
        self._fired = {k for k in (self._fired | keys) if k[1] >= window_start}
        for req in await self._store.claim_run_requests():
            await self._admit_run_now(req)
        self._last_refresh = now
        self._refresh_needed = False

    # ------------------------------------------------------------- evaluation

    async def _evaluate(self, now: datetime) -> None:
        window_start = now - self._lookback
        for program in list(self._programs.values()):
            if not program.enabled or not program.steps:
                continue
            for occ in occurrences_between(program, window_start, now, self._tz):
                key = (program.id, occ)
                if key in self._fired or self._pending(key):
                    continue
                if program.updated_at is not None and occ <= program.updated_at:
                    continue  # occurrence predates the (re)configuration
                try:
                    await self._admit(program, occ, now)
                except Exception:
                    logger.exception(
                        "failed to admit occurrence %s of program %d",
                        occ,
                        program.id,
                    )

    def _pending(self, key: tuple[int, datetime]) -> bool:
        program_id, occ = key
        if any(
            i.program_id == program_id and i.scheduled_for == occ
            for i in self._queue
        ):
            return True
        a = self._active
        return (
            a is not None and a.program_id == program_id and a.scheduled_for == occ
        )

    async def _admit(self, program: Program, occ: datetime, now: datetime) -> None:
        age = (now - occ).total_seconds()
        if age > MISSED_GRACE_SECONDS:
            await self._record_terminal(
                program.id,
                program.name,
                occ,
                "missed",
                f"missed: occurrence was {int(age // 60)} minutes in the past "
                "when evaluated (executor down or busy)",
            )
            return
        if any(
            i.program_id == program.id and i.initiator == INITIATOR_SCHEDULE
            for i in self._queue
        ):
            await self._record_terminal(
                program.id,
                program.name,
                occ,
                "missed",
                "missed: collapsed into an earlier queued occurrence of this program",
            )
            return
        if len(self._queue) >= self._queue_cap:
            await self._record_terminal(
                program.id,
                program.name,
                occ,
                "missed",
                f"missed: queue full (cap {self._queue_cap})",
            )
            return
        self._queue.append(
            QueueItem(program.id, program.name, occ, INITIATOR_SCHEDULE)
        )

    async def _admit_run_now(self, req: RunRequest) -> None:
        program = self._programs.get(req.program_id)
        if program is None or not program.steps:
            logger.warning(
                "run request %d references unknown or empty program %d; ignored",
                req.id,
                req.program_id,
            )
            return
        if len(self._queue) >= self._queue_cap:
            try:
                await self._store.insert_terminal_run(
                    program_id=program.id,
                    program_name=program.name,
                    scheduled_for=None,
                    initiator=req.requested_by,
                    status="missed",
                    note=f"missed: queue full (cap {self._queue_cap})",
                    now=self._clock.now(),
                )
            except Exception:
                logger.exception("failed to record overflowed run request %d", req.id)
            return
        # Run-now jumps the queue but stays FIFO among run-now items.
        index = 0
        for item in self._queue:
            if item.initiator == INITIATOR_SCHEDULE:
                break
            index += 1
        self._queue.insert(
            index, QueueItem(program.id, program.name, None, req.requested_by)
        )

    async def _record_terminal(
        self,
        program_id: int,
        program_name: str,
        scheduled_for: datetime | None,
        status: str,
        note: str | None,
        initiator: str = INITIATOR_SCHEDULE,
    ) -> None:
        await self._store.insert_terminal_run(
            program_id=program_id,
            program_name=program_name,
            scheduled_for=scheduled_for,
            initiator=initiator,
            status=status,
            note=note,
            now=self._clock.now(),
        )
        if scheduled_for is not None:
            self._fired.add((program_id, scheduled_for))

    # ------------------------------------------------------------------- pump

    async def _pump(self, now: datetime) -> None:
        if self._run_task is not None and not self._run_task.done():
            return
        self._run_task = None
        if self._manual_until is not None:
            if now < self._manual_until:
                return  # a manually started zone is running — manual wins
            self._manual_until = None
        while self._queue:
            item = self._queue.popleft()
            program = self._programs.get(item.program_id)
            if program is None or not program.steps:
                continue  # deleted/emptied while queued — drop
            if item.initiator == INITIATOR_SCHEDULE and not program.enabled:
                continue  # disabled while queued — drop
            self._run_task = asyncio.create_task(
                self._execute(program, item), name=f"program-run-{program.id}"
            )
            return

    # -------------------------------------------------------------- execution

    async def _execute(self, program: Program, item: QueueItem) -> None:
        run_id: int | None = None
        in_flight: int | None = None
        started_any = False
        try:
            if item.initiator == INITIATOR_SCHEDULE and program.respect_rain_delay:
                days = 0
                try:
                    days = int(await self._service.get_rain_delay())
                except Exception as err:
                    # Water rather than brown the lawn on unknown rain delay;
                    # a truly unreachable controller fails the steps anyway.
                    logger.warning("rain delay unreadable (%s); watering anyway", err)
                if days > 0:
                    await self._record_terminal(
                        program.id,
                        program.name,
                        item.scheduled_for,
                        "skipped_rain_delay",
                        f"skipped: controller rain delay active "
                        f"({days} day{'s' if days != 1 else ''} remaining)",
                        initiator=item.initiator,
                    )
                    return
            zones = await self._store.fetch_zones()
            step_rows = [
                (
                    step.position,
                    step.zone_id,
                    zones[step.zone_id].name
                    if step.zone_id in zones
                    else f"Zone {step.zone_id}",
                    step.minutes,
                )
                for step in program.steps
            ]
            run_id = await self._store.insert_running_run(
                program_id=program.id,
                program_name=program.name,
                scheduled_for=item.scheduled_for,
                initiator=item.initiator,
                steps=step_rows,
                now=self._clock.now(),
            )
            if item.scheduled_for is not None:
                self._fired.add((program.id, item.scheduled_for))
            self._active = ActiveRun(
                run_id=run_id,
                program_id=program.id,
                program_name=program.name,
                scheduled_for=item.scheduled_for,
                total_steps=len(program.steps),
            )
            outcomes: list[str] = []
            skipped: list[str] = []
            for step in program.steps:
                try:
                    zones = await self._store.fetch_zones()  # freshest enablement
                except Exception:
                    pass  # fall back to the run-start snapshot
                zone = zones.get(step.zone_id)
                if zone is None or not zone.enabled:
                    await self._store.mark_step_finished(
                        run_id, step.position, "skipped_disabled", None
                    )
                    outcomes.append("skipped_disabled")
                    skipped.append(zone.name if zone else f"zone {step.zone_id}")
                    continue
                ok = False
                for _attempt in range(2):  # one retry per spec
                    try:
                        await self._service.start_zone(step.zone_id, step.minutes)
                        ok = True
                        break
                    except Exception as err:
                        logger.warning(
                            "start of zone %d failed: %s", step.zone_id, err
                        )
                if not ok:
                    await self._store.mark_step_finished(
                        run_id, step.position, "failed", None
                    )
                    outcomes.append("failed")
                    continue
                started_any = True
                in_flight = step.position
                started_at = self._clock.now()
                self._active.step_position = step.position
                self._active.step_zone_id = step.zone_id
                self._active.step_deadline = started_at + timedelta(
                    seconds=step.minutes * self._minute_seconds
                )
                await self._store.mark_step_started(run_id, step.position, started_at)
                # Starting the next zone switches (hardware runs one at a time),
                # so no stop between steps — only after the final one.
                await self._clock.sleep(step.minutes * self._minute_seconds)
                await self._store.mark_step_finished(
                    run_id, step.position, "completed", self._clock.now()
                )
                in_flight = None
                outcomes.append("completed")
            if started_any:
                try:
                    await self._service.stop_all()
                except Exception as err:
                    logger.warning("post-run stop_irrigation failed: %s", err)
            status, note = _summarize(outcomes, skipped)
            await self._store.finish_run(run_id, status, note, self._clock.now())
        except asyncio.CancelledError:
            # The canceller (stop-all / manual start / shutdown) owns the
            # hardware action; here we only persist the outcome.
            note = self._cancel_note or "cancelled"
            now = self._clock.now()
            try:
                if run_id is not None:
                    if in_flight is not None:
                        await self._store.mark_step_finished(
                            run_id, in_flight, "cancelled", now
                        )
                    await self._store.finish_run(run_id, "cancelled", note, now)
                elif item.scheduled_for is not None:
                    await self._record_terminal(
                        program.id,
                        program.name,
                        item.scheduled_for,
                        "cancelled",
                        note,
                        initiator=item.initiator,
                    )
            except Exception:
                logger.exception("failed to persist cancellation of run %s", run_id)
                if item.scheduled_for is not None:
                    self._fired.add((program.id, item.scheduled_for))
            raise
        except Exception:
            logger.exception("program run %s crashed", run_id)
            if started_any:
                try:
                    await self._service.stop_all()
                except Exception:
                    pass
            if run_id is not None:
                try:
                    await self._store.finish_run(
                        run_id,
                        "failed",
                        "internal error during run execution",
                        self._clock.now(),
                    )
                except Exception:
                    logger.exception("failed to persist crash of run %s", run_id)
        finally:
            self._active = None
            self._poke.set()

    # ------------------------------------------------------------ cancel/hooks

    async def cancel_active(self, note: str) -> bool:
        """Cancel the active program run, if any; returns True if one was."""
        task = self._run_task
        if task is None or task.done():
            self._run_task = None
            return False
        self._cancel_note = note
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("cancelled run task raised")
        finally:
            self._cancel_note = None
            self._run_task = None
        return True

    async def on_stop_all(self) -> None:
        """POST /api/zones/stop: cancel the active run AND clear the queue."""
        await self.cancel_active("cancelled: stop-all requested")
        await self._clear_queue("cancelled: queue cleared by stop-all")
        self._manual_until = None

    async def on_manual_start(self, minutes: int) -> None:
        """A manual zone start: cancel the active run first (manual always
        wins) and defer queued runs until the manual run's duration elapses."""
        await self.cancel_active("cancelled: manual zone start (manual always wins)")
        self._manual_until = self._clock.now() + timedelta(
            seconds=minutes * self._minute_seconds
        )

    async def _clear_queue(self, note: str) -> None:
        items, self._queue = list(self._queue), deque()
        for item in items:
            if item.scheduled_for is not None:
                self._fired.add((item.program_id, item.scheduled_for))
            try:
                await self._store.insert_terminal_run(
                    program_id=item.program_id,
                    program_name=item.program_name,
                    scheduled_for=item.scheduled_for,
                    initiator=item.initiator,
                    status="cancelled",
                    note=note,
                    now=self._clock.now(),
                )
            except Exception:
                logger.exception("failed to record cancelled queue item")

    # ------------------------------------------------------------------ status

    def status_extras(self) -> tuple[dict | None, dict | None]:
        """(program_run, next_scheduled) additions for GET /api/status."""
        now = self._clock.now()
        program_run = None
        active = self._active
        if active is not None and active.step_position is not None:
            remaining = 0
            if active.step_deadline is not None:
                remaining = max(
                    0, int(round((active.step_deadline - now).total_seconds()))
                )
            program_run = {
                "run_id": active.run_id,
                "program_name": active.program_name,
                "step_position": active.step_position,
                "step_zone_id": active.step_zone_id,
                "step_remaining_seconds": remaining,
                "total_steps": active.total_steps,
            }
        nxt = next_occurrence(self._programs.values(), now, self._horizon, self._tz)
        next_scheduled = (
            {"program_name": nxt[0], "at": nxt[1].astimezone(self._tz).isoformat()}
            if nxt
            else None
        )
        return program_run, next_scheduled
