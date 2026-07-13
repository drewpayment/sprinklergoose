"""Shared fakes for scheduler tests: deterministic clock, in-memory store,
and a recording irrigation service. Mirrors the SchedulerStore /
IrrigationService / Clock protocols in app.scheduler."""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.scheduler import Program, ProgramStep, RunRequest, ZoneRow

TZ = ZoneInfo("America/Detroit")

# Wednesday, 2026-07-15 (EDT, UTC-4). Base date for most unit tests.
BASE_DAY = date(2026, 7, 15)


def local(hour: int, minute: int = 0, second: int = 0, day: date = BASE_DAY) -> datetime:
    """Aware local (Detroit) datetime on the test base day."""
    return datetime(day.year, day.month, day.day, hour, minute, second, tzinfo=TZ)


async def drain(cycles: int = 30) -> None:
    """Yield to the event loop until spawned tasks make progress."""
    for _ in range(cycles):
        await asyncio.sleep(0)


async def wait_until(predicate, timeout: float = 3.0, interval: float = 0.01) -> None:
    """Real-time wait for tests whose tasks do real (paced) awaits."""
    import time as _time

    deadline = _time.monotonic() + timeout
    while _time.monotonic() < deadline:
        if predicate():
            return
        await asyncio.sleep(interval)
    raise AssertionError("condition not met within timeout")


class FakeClock:
    """Virtual time. `advance` walks through sleeper deadlines in order so
    timestamps recorded mid-run are exact."""

    def __init__(self, start: datetime) -> None:
        assert start.tzinfo is not None
        self._now = start.astimezone(UTC)
        self._waiters: list[list] = []  # [deadline, Event]

    def now(self) -> datetime:
        return self._now

    async def sleep(self, seconds: float) -> None:
        if seconds <= 0:
            await asyncio.sleep(0)
            return
        waiter = [self._now + timedelta(seconds=seconds), asyncio.Event()]
        self._waiters.append(waiter)
        try:
            await waiter[1].wait()
        finally:
            if waiter in self._waiters:
                self._waiters.remove(waiter)

    async def advance(self, seconds: float) -> None:
        target = self._now + timedelta(seconds=seconds)
        for _ in range(1000):
            await drain()
            due = [w for w in self._waiters if w[0] <= target and not w[1].is_set()]
            if not due:
                break
            self._now = max(self._now, min(w[0] for w in due))
            for w in list(self._waiters):
                if w[0] <= self._now:
                    w[1].set()
            await drain()
        self._now = target
        await drain()


class FakeIrrigation:
    """IrrigationService stand-in that records calls."""

    def __init__(self) -> None:
        self.rain_delay = 0
        self.rain_delay_error = False
        self.calls: list[tuple] = []
        # zone_id -> number of start attempts that should fail
        self.fail_start: dict[int, int] = {}

    def start_calls(self) -> list[tuple[int, int]]:
        return [(c[1], c[2]) for c in self.calls if c[0] == "start"]

    def stop_count(self) -> int:
        return sum(1 for c in self.calls if c[0] == "stop")

    async def start_zone(self, zone_id: int, minutes: int) -> list[int]:
        if self.fail_start.get(zone_id, 0) > 0:
            self.fail_start[zone_id] -= 1
            self.calls.append(("start_fail", zone_id, minutes))
            raise RuntimeError("controller unreachable")
        self.calls.append(("start", zone_id, minutes))
        return [zone_id]

    async def stop_all(self) -> list[int]:
        self.calls.append(("stop",))
        return []

    async def get_rain_delay(self) -> int:
        if self.rain_delay_error:
            raise RuntimeError("controller unreachable")
        return self.rain_delay


class FakeSchedulerStore:
    """In-memory SchedulerStore mirroring the M2 schema semantics."""

    def __init__(self) -> None:
        self.programs: list[Program] = []
        self.zones: dict[int, ZoneRow] = {
            i: ZoneRow(id=i, name=f"Zone {i}", enabled=i <= 5) for i in range(1, 8)
        }
        self.run_requests: list[dict] = []
        self.runs: list[dict] = []
        self.run_steps: list[dict] = []
        self._next_run_id = 1
        self._next_request_id = 1
        self.fail_writes = False
        self.fail_reads = False

    # ------------------------------------------------------------- helpers

    def add_run_request(self, program_id: int, requested_by: str) -> int:
        request_id = self._next_request_id
        self._next_request_id += 1
        self.run_requests.append(
            {
                "id": request_id,
                "program_id": program_id,
                "requested_by": requested_by,
                "claimed_at": None,
            }
        )
        return request_id

    def run(self, run_id: int) -> dict:
        return next(r for r in self.runs if r["id"] == run_id)

    def runs_with(self, status: str) -> list[dict]:
        return [r for r in self.runs if r["status"] == status]

    def steps_for(self, run_id: int) -> list[dict]:
        return sorted(
            (s for s in self.run_steps if s["run_id"] == run_id),
            key=lambda s: s["position"],
        )

    def seed_running_run(
        self, program_id: int, program_name: str, scheduled_for, started_at
    ) -> int:
        """Simulate a run left 'running' by a crash (M2.E9 setup)."""
        run_id = self._next_run_id
        self._next_run_id += 1
        self.runs.append(
            {
                "id": run_id,
                "program_id": program_id,
                "program_name": program_name,
                "scheduled_for": scheduled_for,
                "initiator": "schedule",
                "status": "running",
                "started_at": started_at,
                "finished_at": None,
                "note": None,
            }
        )
        self.run_steps.append(
            {
                "run_id": run_id,
                "position": 0,
                "zone_id": 1,
                "zone_name": "Zone 1",
                "planned_minutes": 10,
                "started_at": started_at,
                "finished_at": None,
                "outcome": None,
            }
        )
        return run_id

    def _check_write(self) -> None:
        if self.fail_writes:
            raise RuntimeError("db down (write)")

    def _check_read(self) -> None:
        if self.fail_reads:
            raise RuntimeError("db down (read)")

    # ------------------------------------------------------------ protocol

    async def fetch_programs(self) -> list[Program]:
        self._check_read()
        return list(self.programs)

    async def fetch_zones(self) -> dict[int, ZoneRow]:
        self._check_read()
        return dict(self.zones)

    async def claim_run_requests(self) -> list[RunRequest]:
        self._check_read()
        claimed = []
        for req in self.run_requests:
            if req["claimed_at"] is None:
                req["claimed_at"] = datetime.now(UTC)
                claimed.append(
                    RunRequest(
                        id=req["id"],
                        program_id=req["program_id"],
                        requested_by=req["requested_by"],
                    )
                )
        return claimed

    async def recent_run_keys(self, since: datetime) -> set[tuple[int, datetime]]:
        self._check_read()
        return {
            (r["program_id"], r["scheduled_for"])
            for r in self.runs
            if r["program_id"] is not None
            and r["scheduled_for"] is not None
            and r["scheduled_for"] >= since
        }

    async def insert_terminal_run(
        self, *, program_id, program_name, scheduled_for, initiator, status, note, now
    ) -> int:
        self._check_write()
        run_id = self._next_run_id
        self._next_run_id += 1
        self.runs.append(
            {
                "id": run_id,
                "program_id": program_id,
                "program_name": program_name,
                "scheduled_for": scheduled_for,
                "initiator": initiator,
                "status": status,
                "started_at": None,
                "finished_at": now,
                "note": note,
            }
        )
        return run_id

    async def insert_running_run(
        self, *, program_id, program_name, scheduled_for, initiator, steps, now
    ) -> int:
        self._check_write()
        run_id = self._next_run_id
        self._next_run_id += 1
        self.runs.append(
            {
                "id": run_id,
                "program_id": program_id,
                "program_name": program_name,
                "scheduled_for": scheduled_for,
                "initiator": initiator,
                "status": "running",
                "started_at": now,
                "finished_at": None,
                "note": None,
            }
        )
        for position, zone_id, zone_name, minutes in steps:
            self.run_steps.append(
                {
                    "run_id": run_id,
                    "position": position,
                    "zone_id": zone_id,
                    "zone_name": zone_name,
                    "planned_minutes": minutes,
                    "started_at": None,
                    "finished_at": None,
                    "outcome": None,
                }
            )
        return run_id

    async def mark_step_started(self, run_id, position, now) -> None:
        self._check_write()
        for step in self.run_steps:
            if step["run_id"] == run_id and step["position"] == position:
                step["started_at"] = now

    async def mark_step_finished(self, run_id, position, outcome, finished_at) -> None:
        self._check_write()
        for step in self.run_steps:
            if step["run_id"] == run_id and step["position"] == position:
                step["outcome"] = outcome
                step["finished_at"] = finished_at

    async def finish_run(self, run_id, status, note, now) -> None:
        self._check_write()
        run = self.run(run_id)
        run["status"] = status
        run["note"] = note
        run["finished_at"] = now

    async def finalize_orphans(self, now) -> int:
        self._check_write()
        count = 0
        for run in self.runs:
            if run["status"] != "running":
                continue
            for step in self.steps_for(run["id"]):
                if (
                    step["started_at"] is not None
                    and step["finished_at"] is None
                    and step["outcome"] is None
                ):
                    step["outcome"] = "cancelled"
                    step["finished_at"] = now
            run["status"] = "cancelled"
            run["finished_at"] = now
            run["note"] = "cancelled: executor restarted mid-run"
            count += 1
        return count

    async def listen(self, on_event) -> None:
        await asyncio.Event().wait()  # never fires; unit tests poke directly

    async def close(self) -> None:
        pass


def make_program(
    program_id: int = 1,
    name: str = "Lawn",
    times: tuple[str, ...] = ("06:00",),
    day_type: str = "days_of_week",
    days: tuple[int, ...] = (0, 1, 2, 3, 4, 5, 6),
    interval_days: int | None = None,
    anchor: date | None = None,
    respect_rain_delay: bool = True,
    steps: tuple[tuple[int, int], ...] = ((1, 10),),
    enabled: bool = True,
    updated_at: datetime | None = None,
) -> Program:
    return Program(
        id=program_id,
        name=name,
        enabled=enabled,
        start_times=tuple(time.fromisoformat(t) for t in times),
        day_type=day_type,
        days_of_week=tuple(days) if day_type == "days_of_week" else None,
        interval_days=interval_days,
        anchor_date=anchor,
        respect_rain_delay=respect_rain_delay,
        steps=tuple(
            ProgramStep(position=i, zone_id=zone, minutes=minutes)
            for i, (zone, minutes) in enumerate(steps)
        ),
        updated_at=updated_at,
    )
