"""M2 W1 integration tests against a REAL throwaway Postgres container.

Covers M2.E5 (NOTIFY -> run_request claimed and watering started <=5s),
M2.E7 (15s poll fallback, no NOTIFY), M2.E8 (full scheduler cycle with only
Postgres running — no web app), and M2.E9 against real SQL.

Hardware safety: the controller here is the in-process FakeController — no
network service is bound at all, and nothing ever talks to :8000 or
192.168.86.173. Postgres runs on a free local port (starting at 5436) in a
uniquely named container that is always removed.
"""

import asyncio
import socket
import subprocess
import time as _time
import uuid
from datetime import UTC, date, datetime, time, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.rainbird import RainbirdService
from app.scheduler import Scheduler
from app.scheduler_db import AsyncpgSchedulerStore
from app.zone_names import ZoneNameStore

from .conftest import FakeController
from .scheduler_testkit import wait_until

TZ = ZoneInfo("America/Detroit")

SCHEMA = """
CREATE TABLE zones (
  id integer PRIMARY KEY,
  name varchar(40) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE programs (
  id            serial PRIMARY KEY,
  name          varchar(60) NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  start_times   time[] NOT NULL,
  day_type      text NOT NULL CHECK (day_type IN ('days_of_week','interval')),
  days_of_week  int[],
  interval_days int,
  anchor_date   date,
  respect_rain_delay boolean NOT NULL DEFAULT true,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE program_steps (
  id serial PRIMARY KEY,
  program_id int NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  position   int NOT NULL,
  zone_id    int NOT NULL REFERENCES zones(id),
  minutes    int NOT NULL CHECK (minutes BETWEEN 1 AND 240),
  UNIQUE (program_id, position)
);
CREATE TABLE run_requests (
  id           serial PRIMARY KEY,
  program_id   int NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  requested_by text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  claimed_at   timestamptz
);
CREATE TABLE program_runs (
  id            serial PRIMARY KEY,
  program_id    int REFERENCES programs(id) ON DELETE SET NULL,
  program_name  varchar(60) NOT NULL,
  scheduled_for timestamptz,
  initiator     text NOT NULL,
  status        text NOT NULL CHECK (status IN
                ('running','completed','partial','failed','cancelled',
                 'skipped_rain_delay','missed')),
  started_at    timestamptz,
  finished_at   timestamptz,
  note          text
);
CREATE TABLE program_run_steps (
  id         serial PRIMARY KEY,
  run_id     int NOT NULL REFERENCES program_runs(id) ON DELETE CASCADE,
  position   int NOT NULL,
  zone_id    int NOT NULL,
  zone_name  varchar(40) NOT NULL,
  planned_minutes int NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  outcome    text CHECK (outcome IN
             ('completed','cancelled','failed','skipped_disabled'))
);
INSERT INTO zones (id, name, enabled) VALUES
  (1, 'Front Lawn', true), (2, 'Back Lawn', true), (3, 'Side Beds', true),
  (4, 'Garden', true), (5, 'Front Beds', true),
  (6, 'Zone 6', false), (7, 'Zone 7', false);
"""


def _docker_available() -> bool:
    try:
        return (
            subprocess.run(
                ["docker", "info"], capture_output=True, timeout=20
            ).returncode
            == 0
        )
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _docker_available(), reason="docker is required for Postgres integration"
)


def _free_port(preferred: int = 5436) -> int:
    for candidate in (preferred, 0):
        with socket.socket() as sock:
            try:
                sock.bind(("127.0.0.1", candidate))
                return sock.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free port")


async def _wait_and_init(dsn: str) -> None:
    import asyncpg

    last_err: Exception | None = None
    for _ in range(120):
        try:
            conn = await asyncpg.connect(dsn, timeout=2)
            break
        except Exception as err:  # container still starting
            last_err = err
            await asyncio.sleep(0.5)
    else:
        raise RuntimeError(f"postgres never became ready: {last_err}")
    try:
        await conn.execute(SCHEMA)
    finally:
        await conn.close()


@pytest.fixture(scope="session")
def pg_dsn():
    port = _free_port()
    name = f"rainbird-m2-test-pg-{uuid.uuid4().hex[:8]}"
    subprocess.run(
        [
            "docker", "run", "-d", "--rm", "--name", name,
            "-e", "POSTGRES_PASSWORD=test",
            "-p", f"127.0.0.1:{port}:5432",
            "postgres:16-alpine",
        ],
        check=True,
        capture_output=True,
    )
    dsn = f"postgresql://postgres:test@127.0.0.1:{port}/postgres"
    try:
        asyncio.run(_wait_and_init(dsn))
        yield dsn
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


@pytest.fixture
async def db(pg_dsn):
    """A per-test asyncpg connection over truncated tables."""
    import asyncpg

    conn = await asyncpg.connect(pg_dsn)
    await conn.execute(
        "TRUNCATE program_run_steps, program_runs, run_requests,"
        " program_steps, programs RESTART IDENTITY CASCADE"
    )
    yield conn
    await conn.close()


@pytest.fixture
async def rig(pg_dsn, db, zone_names_file):
    """Real store + real clock + real background loop, fake controller."""
    controller = FakeController(latency=0.005)
    service = RainbirdService(
        host="127.0.0.1",
        password="test",
        zone_names=ZoneNameStore(zone_names_file),
        controller_factory=lambda: controller,
    )
    store = AsyncpgSchedulerStore(pg_dsn)
    scheduler = Scheduler(
        store=store,
        service=service,
        timezone="America/Detroit",
        minute_seconds=0.3,  # test seam: a program "minute" is 0.3s here
    )
    rig = SimpleNamespace(
        controller=controller,
        service=service,
        store=store,
        scheduler=scheduler,
        db=db,
        dsn=pg_dsn,
    )
    yield rig
    await scheduler.stop()
    await service.close()


async def insert_program(
    conn,
    name: str,
    start_times: list[time],
    steps: list[tuple[int, int]],
    day_type: str = "days_of_week",
    days: list[int] | None = None,
    interval_days: int | None = None,
    anchor: date | None = None,
    enabled: bool = True,
    respect_rain_delay: bool = True,
) -> int:
    if day_type == "days_of_week" and days is None:
        days = list(range(7))
    program_id = await conn.fetchval(
        "INSERT INTO programs (name, enabled, start_times, day_type,"
        " days_of_week, interval_days, anchor_date, respect_rain_delay)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
        name,
        enabled,
        start_times,
        day_type,
        days,
        interval_days,
        anchor,
        respect_rain_delay,
    )
    for position, (zone_id, minutes) in enumerate(steps):
        await conn.execute(
            "INSERT INTO program_steps (program_id, position, zone_id, minutes)"
            " VALUES ($1, $2, $3, $4)",
            program_id,
            position,
            zone_id,
            minutes,
        )
    return program_id


async def start_and_wait_ready(rig) -> None:
    await rig.scheduler.start()
    await wait_until(lambda: rig.scheduler._ready, timeout=10)


# --------------------------------------------------------------------- M2.E5


async def test_notify_claims_run_request_and_starts_within_5s(rig):
    # A program with no upcoming scheduled occurrence (anchor far in the future).
    program_id = await insert_program(
        rig.db,
        "Run Now Only",
        [time(12, 0)],
        [(1, 1)],
        day_type="interval",
        interval_days=30,
        anchor=date(2031, 1, 1),
    )
    await start_and_wait_ready(rig)
    await wait_until(lambda: rig.store.listening, timeout=10)

    await rig.db.execute(
        "INSERT INTO run_requests (program_id, requested_by) VALUES ($1, $2)",
        program_id,
        "drew.payment@gmail.com",
    )
    started = _time.monotonic()
    await rig.db.execute("NOTIFY sprinkler_events")
    await wait_until(
        lambda: rig.controller.call_count("irrigate_zone") > 0, timeout=6
    )
    elapsed = _time.monotonic() - started
    assert elapsed <= 5.0, f"watering started {elapsed:.2f}s after NOTIFY"

    claimed_at = await rig.db.fetchval("SELECT claimed_at FROM run_requests")
    assert claimed_at is not None

    async def run_row():
        return await rig.db.fetchrow("SELECT * FROM program_runs")

    row = await run_row()
    assert row["initiator"] == "drew.payment@gmail.com"
    assert row["scheduled_for"] is None

    deadline = _time.monotonic() + 10
    while _time.monotonic() < deadline:
        row = await run_row()
        if row["status"] == "completed":
            break
        await asyncio.sleep(0.1)
    assert row["status"] == "completed"
    assert rig.controller.call_count("stop_irrigation") >= 1


# --------------------------------------------------------------------- M2.E7


async def test_program_changes_picked_up_within_15s_without_notify(rig):
    await start_and_wait_ready(rig)

    def next_name():
        _, nxt = rig.scheduler.status_extras()
        return nxt["program_name"] if nxt else None

    # Create (no NOTIFY issued anywhere in this test).
    soon = (datetime.now(TZ) + timedelta(hours=2)).time().replace(microsecond=0)
    await insert_program(rig.db, "Poll Pickup", [soon], [(2, 1)])
    created = _time.monotonic()
    await wait_until(lambda: next_name() == "Poll Pickup", timeout=20, interval=0.1)
    assert _time.monotonic() - created <= 16.0

    # Disable (still no NOTIFY).
    await rig.db.execute("UPDATE programs SET enabled = false, updated_at = now()")
    disabled = _time.monotonic()
    await wait_until(lambda: next_name() is None, timeout=20, interval=0.1)
    assert _time.monotonic() - disabled <= 16.0


# --------------------------------------------------------- M2.E8 (and E1)


async def test_full_scheduler_cycle_with_only_postgres(rig):
    """No web app, no NOTIFY: program definition read by poll, occurrence
    fires within 60s (M2.E1 real-tick — the occurrence is seconds away),
    steps run sequentially, history rows land, no double-fire."""
    now_local = datetime.now(TZ)
    occurrence_local = (now_local + timedelta(seconds=8)).replace(microsecond=0)
    await insert_program(
        rig.db,
        "Morning Cycle",
        [occurrence_local.time()],
        [(1, 1), (3, 2)],
    )
    await start_and_wait_ready(rig)

    async def fetch_run():
        return await rig.db.fetchrow("SELECT * FROM program_runs")

    deadline = _time.monotonic() + 45
    row = None
    while _time.monotonic() < deadline:
        row = await fetch_run()
        if row is not None and row["status"] == "completed":
            break
        await asyncio.sleep(0.2)
    assert row is not None and row["status"] == "completed", f"run row: {row}"

    assert row["initiator"] == "schedule"
    assert row["scheduled_for"] == occurrence_local.astimezone(UTC)
    # M2.E1: fired within 60 seconds of the occurrence.
    assert (row["started_at"] - row["scheduled_for"]).total_seconds() <= 60
    assert row["finished_at"] is not None

    steps = await rig.db.fetch(
        "SELECT * FROM program_run_steps ORDER BY position"
    )
    assert [s["outcome"] for s in steps] == ["completed", "completed"]
    assert [s["zone_name"] for s in steps] == ["Front Lawn", "Side Beds"]
    assert all(s["started_at"] and s["finished_at"] for s in steps)
    assert steps[0]["finished_at"] <= steps[1]["started_at"]  # sequential
    assert rig.controller.call_count("irrigate_zone") == 2
    assert rig.controller.call_count("stop_irrigation") >= 1

    # Dedupe across further real ticks: the run row is the watermark.
    await asyncio.sleep(6)
    count = await rig.db.fetchval("SELECT count(*) FROM program_runs")
    assert count == 1


# --------------------------------------------------------------------- M2.E9


async def test_orphaned_running_row_finalized_on_startup(rig):
    run_id = await rig.db.fetchval(
        "INSERT INTO program_runs"
        " (program_id, program_name, scheduled_for, initiator, status, started_at)"
        " VALUES (NULL, 'Crashed', now() - interval '5 minutes', 'schedule',"
        "  'running', now() - interval '5 minutes') RETURNING id"
    )
    await rig.db.execute(
        "INSERT INTO program_run_steps"
        " (run_id, position, zone_id, zone_name, planned_minutes, started_at)"
        " VALUES ($1, 0, 1, 'Front Lawn', 10, now() - interval '5 minutes')",
        run_id,
    )
    await start_and_wait_ready(rig)

    row = await rig.db.fetchrow(
        "SELECT status, note, finished_at FROM program_runs WHERE id = $1", run_id
    )
    assert row["status"] == "cancelled"
    assert "restarted" in row["note"]
    assert row["finished_at"] is not None
    step = await rig.db.fetchrow(
        "SELECT outcome, finished_at FROM program_run_steps WHERE run_id = $1", run_id
    )
    assert step["outcome"] == "cancelled"
    assert step["finished_at"] is not None
    assert rig.controller.call_count("irrigate_zone") == 0
