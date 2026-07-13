"""M2 W1: scheduler wired through the API endpoints (M2.E2, E3, E10).

Uses the existing FakeController + real RainbirdService (so the N1 lock and
pacing are exercised on scheduler paths too) with the fake store and clock.
ASGITransport does not run lifespan, so ticks are driven manually — which is
exactly what these tests want.
"""

import asyncio
from datetime import timedelta

import httpx
import pytest

from app.main import create_app
from app.scheduler import Scheduler

from .scheduler_testkit import (
    FakeClock,
    FakeSchedulerStore,
    drain,
    local,
    make_program,
    wait_until,
)
from .test_pacing import assert_serialized_and_paced


@pytest.fixture
def sched_store() -> FakeSchedulerStore:
    return FakeSchedulerStore()


@pytest.fixture
def sched_clock() -> FakeClock:
    return FakeClock(local(5, 59, 58))


@pytest.fixture
def scheduler(sched_store, service, sched_clock) -> Scheduler:
    return Scheduler(
        store=sched_store,
        service=service,
        clock=sched_clock,
        timezone="America/Detroit",
        # Keep yesterday's occurrences (24h default would backfill them as
        # `missed`) out of these endpoint-focused tests.
        lookback=timedelta(hours=2),
    )


@pytest.fixture
async def sched_client(settings, service, scheduler):
    app = create_app(settings=settings, service=service, scheduler=scheduler)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def start_program_run(scheduler, sched_clock) -> None:
    """Advance past 06:00 and tick until the default program's first step
    has actually started on the (fake) hardware."""
    await sched_clock.advance(4)
    await scheduler.tick()
    await wait_until(
        lambda: scheduler._active is not None
        and scheduler._active.step_position is not None
    )
    await drain()


# ------------------------------------------------------------ status (E10)


async def test_status_fields_null_without_scheduler(client):
    """The v1-shaped app (no DATABASE_URL): fields exist, always null."""
    body = (await client.get("/api/status")).json()
    assert body["program_run"] is None
    assert body["next_scheduled"] is None


async def test_status_next_scheduled_shape(sched_client, sched_store, scheduler):
    sched_store.programs = [make_program(name="Front Beds", times=("06:00",))]
    await scheduler.tick()
    body = (await sched_client.get("/api/status")).json()
    assert body["program_run"] is None
    assert body["next_scheduled"] == {
        "program_name": "Front Beds",
        "at": local(6, 0).isoformat(),
    }


async def test_status_program_run_shape_and_countdown(
    sched_client, sched_store, scheduler, sched_clock
):
    sched_store.programs = [make_program(name="Lawn", steps=((3, 10), (4, 5)))]
    await start_program_run(scheduler, sched_clock)

    body = (await sched_client.get("/api/status")).json()
    run_id = sched_store.runs[0]["id"]
    assert body["program_run"] == {
        "run_id": run_id,
        "program_name": "Lawn",
        "step_position": 0,
        "step_zone_id": 3,
        "step_remaining_seconds": 600,
        "total_steps": 2,
    }
    assert body["zones"][2]["active"] is True  # zone 3 running on the controller

    await sched_clock.advance(240)
    body = (await sched_client.get("/api/status")).json()
    assert body["program_run"]["step_remaining_seconds"] == 360


# ------------------------------------------------- stop-all endpoint (E3)


async def test_stop_endpoint_cancels_run_and_clears_queue(
    sched_client, sched_store, scheduler, sched_clock, fake_controller
):
    sched_store.programs = [
        make_program(program_id=1, name="A", steps=((1, 30),)),
        make_program(program_id=2, name="B", times=("06:01",), steps=((2, 5),)),
    ]
    await start_program_run(scheduler, sched_clock)
    await sched_clock.advance(120)
    await scheduler.tick()  # B queued behind A
    await drain()
    assert fake_controller.active_zones == {1}

    resp = await sched_client.post("/api/zones/stop")
    assert resp.status_code == 200
    assert resp.json() == {"active_zones": []}
    assert fake_controller.active_zones == set()

    a_run = next(r for r in sched_store.runs if r["program_name"] == "A")
    assert a_run["status"] == "cancelled"
    assert sched_store.steps_for(a_run["id"])[0]["outcome"] == "cancelled"
    b_run = next(r for r in sched_store.runs if r["program_name"] == "B")
    assert b_run["status"] == "cancelled"
    assert len(scheduler._queue) == 0
    # Exactly one hardware stop — from the endpoint, none from the scheduler.
    assert fake_controller.call_count("stop_irrigation") == 1

    body = (await sched_client.get("/api/status")).json()
    assert body["program_run"] is None


# -------------------------------------------- manual start wins (E3)


async def test_manual_zone_start_cancels_program_run_first(
    sched_client, sched_store, scheduler, sched_clock, fake_controller
):
    sched_store.programs = [make_program(name="A", steps=((3, 30),))]
    await start_program_run(scheduler, sched_clock)
    assert fake_controller.active_zones == {3}

    resp = await sched_client.post("/api/zones/1/start", json={"minutes": 5})
    assert resp.status_code == 200
    assert resp.json() == {"active_zones": [1]}
    assert fake_controller.active_zones == {1}  # manual zone took over

    run = sched_store.runs[0]
    assert run["status"] == "cancelled"  # cancelled BEFORE the manual start
    assert "manual" in run["note"]
    body = (await sched_client.get("/api/status")).json()
    assert body["program_run"] is None
    assert body["zones"][0]["active"] is True


async def test_manual_start_defers_queued_programs(
    sched_client, sched_store, scheduler, sched_clock, fake_controller
):
    sched_store.programs = [make_program(name="A", times=("06:01",), steps=((2, 5),))]
    await scheduler.tick()
    resp = await sched_client.post("/api/zones/1/start", json={"minutes": 10})
    assert resp.status_code == 200

    await sched_clock.advance(180)  # 06:02:58 — A due, manual zone running
    await scheduler.tick()
    await drain()
    assert not any(r["program_name"] == "A" for r in sched_store.runs)
    assert fake_controller.active_zones == {1}  # untouched

    await sched_clock.advance(8 * 60)  # manual duration elapses
    await scheduler.tick()
    await wait_until(lambda: fake_controller.active_zones == {2})
    run = next(r for r in sched_store.runs if r["program_name"] == "A")
    assert run["status"] == "running"


# ------------------------------------------------ N1 with scheduler (E2)


async def test_scheduler_traffic_shares_the_n1_lock(
    sched_client, sched_store, scheduler, sched_clock, fake_controller
):
    """Status polls hammering the API while the scheduler starts a program:
    the module must never see concurrent or unpaced calls."""
    sched_store.programs = [make_program(name="A", steps=((1, 10),))]
    await sched_clock.advance(4)
    tick_task = asyncio.create_task(scheduler.tick())
    responses = await asyncio.gather(
        *(sched_client.get("/api/status") for _ in range(4))
    )
    await tick_task
    await drain()
    assert all(r.status_code == 200 for r in responses)
    assert fake_controller.max_in_flight == 1, "module saw concurrent calls"
    assert_serialized_and_paced(fake_controller.calls)
    assert sched_store.runs[0]["status"] == "running"
