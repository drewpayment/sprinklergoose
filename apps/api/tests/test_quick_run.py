"""M3.Q unit tests: Quick Run (manual multi-zone, program-less run_request).

Every test drives Scheduler.tick() directly with a virtual clock — no real
time, no database, no controller. Mirrors the style of test_scheduler_unit.py;
see docs/M3-SPEC.md "M3.Q — Quick Run" for the acceptance criteria (Q.E1-E6)
each test group below is named after.
"""

from datetime import timedelta

import pytest

from app.scheduler import (
    QUICK_RUN_MAX_STEPS,
    QUICK_RUN_NAME,
    Scheduler,
    parse_quick_run_steps,
)

from .scheduler_testkit import (
    FakeClock,
    FakeIrrigation,
    FakeSchedulerStore,
    FakeWeatherSource,
    drain,
    local,
    make_program,
    make_weather_settings,
)


@pytest.fixture
def store() -> FakeSchedulerStore:
    return FakeSchedulerStore()


@pytest.fixture
def irrigation() -> FakeIrrigation:
    return FakeIrrigation()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(local(5, 59, 58))


def make_scheduler(store, irrigation, clock, **kwargs) -> Scheduler:
    kwargs.setdefault("lookback", timedelta(hours=2))
    return Scheduler(
        store=store, service=irrigation, clock=clock, timezone="America/Detroit", **kwargs
    )


async def tick(scheduler: Scheduler) -> None:
    await scheduler.tick()
    await drain()


def _long_runner(program_id: int, name: str, hour: int, minute: int = 0):
    return make_program(
        program_id=program_id,
        name=name,
        times=(f"{hour:02d}:{minute:02d}",),
        steps=((1, 30),),
    )


# ------------------------------------------------------- Q.E1: payload order


async def test_quick_run_executes_steps_sequentially_history_exact(
    store, irrigation, clock
):
    store.add_quick_run_request(
        [{"zone_id": 3, "minutes": 5}, {"zone_id": 1, "minutes": 10}],
        "drew@example.com",
    )
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)

    assert irrigation.start_calls() == [(3, 5)]
    run = store.runs[0]
    assert run["program_id"] is None
    assert run["program_name"] == QUICK_RUN_NAME
    assert run["scheduled_for"] is None
    assert run["initiator"] == "drew@example.com"
    assert run["status"] == "running"

    steps = store.steps_for(run["id"])
    assert [(s["position"], s["zone_id"], s["planned_minutes"]) for s in steps] == [
        (0, 3, 5),
        (1, 1, 10),
    ]
    assert steps[0]["zone_name"] == "Zone 3"

    await clock.advance(5 * 60)  # step 0 elapses -> step 1 starts (switch)
    assert irrigation.start_calls() == [(3, 5), (1, 10)]
    await clock.advance(10 * 60)  # step 1 elapses -> stop

    run = store.run(run["id"])
    assert run["status"] == "completed"
    steps = store.steps_for(run["id"])
    assert [s["outcome"] for s in steps] == ["completed", "completed"]
    assert steps[0]["finished_at"] <= steps[1]["started_at"]  # strictly sequential
    assert irrigation.stop_count() == 1


# --------------------------------------------------------- Q.E2: queue jump


async def test_quick_run_jumps_queue_ahead_of_scheduled_fifo_among_manual(
    store, irrigation, clock
):
    store.programs = [
        _long_runner(1, "A", 6),
        make_program(program_id=2, name="B", times=("06:01",), steps=((2, 1),)),
        make_program(program_id=3, name="C", times=("23:00",), steps=((3, 1),)),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)  # A starts
    await clock.advance(120)
    await tick(scheduler)  # B queued (scheduled)

    store.add_run_request(3, "one@example.com")
    store.add_quick_run_request([{"zone_id": 1, "minutes": 2}], "two@example.com")
    scheduler._on_notify()
    await tick(scheduler)  # claims both -> manual items ahead of B, FIFO

    assert [i.program_name for i in scheduler._queue] == ["C", QUICK_RUN_NAME, "B"]


async def test_quick_run_overflow_recorded_missed(store, irrigation, clock):
    programs = [_long_runner(1, "A", 6)]
    for i in range(2, 7):  # 5 programs due 06:01..06:05 -> fills the cap
        programs.append(
            make_program(
                program_id=i,
                name=f"P{i}",
                times=(f"06:{i - 1:02d}",),
                steps=((2, 1),),
            )
        )
    store.programs = programs
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)  # A starts
    await clock.advance(6 * 60)  # all 5 due
    await tick(scheduler)
    assert len(scheduler._queue) == 5

    store.add_quick_run_request([{"zone_id": 1, "minutes": 2}], "drew@example.com")
    scheduler._on_notify()
    await tick(scheduler)

    overflow = [
        r for r in store.runs if r["status"] == "missed" and r["program_name"] == QUICK_RUN_NAME
    ]
    assert len(overflow) == 1
    assert overflow[0]["program_id"] is None
    assert overflow[0]["initiator"] == "drew@example.com"
    assert "queue full" in overflow[0]["note"]
    assert len(scheduler._queue) == 5  # dropped, not inserted


async def test_quick_run_bypasses_rain_delay_and_weather(store, irrigation, clock):
    irrigation.rain_delay = 3  # would skip a respecting scheduled program
    weather_source = FakeWeatherSource(past24_mm=100.0)  # would also skip
    store.weather_settings = make_weather_settings(enabled=True)
    store.add_quick_run_request([{"zone_id": 1, "minutes": 2}], "drew@example.com")
    scheduler = make_scheduler(store, irrigation, clock, weather_source=weather_source)
    await tick(scheduler)

    assert irrigation.start_calls() == [(1, 2)]
    run = store.runs[0]
    assert run["status"] == "running"
    assert weather_source.fetches == 0  # bypassed entirely, not even fetched
    assert not any(r["status"] in ("skipped_rain_delay", "skipped_weather") for r in store.runs)


# ---------------------------------------------------- Q.E3: disabled zone


async def test_quick_run_disabled_zone_skipped_remaining_run_completed(
    store, irrigation, clock
):
    # Zone 6 is disabled per FakeSchedulerStore's default zone fixture.
    store.add_quick_run_request(
        [{"zone_id": 6, "minutes": 5}, {"zone_id": 1, "minutes": 10}],
        "drew@example.com",
    )
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    await clock.advance(600)

    run = store.runs[0]
    assert run["status"] == "completed"  # skip alone stays completed (M2.E6)
    steps = store.steps_for(run["id"])
    assert steps[0]["outcome"] == "skipped_disabled"
    assert steps[0]["started_at"] is None
    assert steps[1]["outcome"] == "completed"
    assert irrigation.start_calls() == [(1, 10)]  # zone 6 never touched


# ------------------------------------------------------ Q.E4: cancellation


async def test_stop_all_cancels_quick_run_and_clears_queue(store, irrigation, clock):
    store.add_quick_run_request([{"zone_id": 1, "minutes": 30}], "drew@example.com")
    store.programs = [make_program(program_id=2, name="B", times=("06:01",), steps=((2, 1),))]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)  # quick run starts
    await clock.advance(120)
    await tick(scheduler)  # B queued behind it

    await scheduler.on_stop_all()
    await drain()

    run = store.run(store.runs[0]["id"])
    assert run["status"] == "cancelled"
    assert run["program_id"] is None
    assert "stop-all" in run["note"]
    step = store.steps_for(run["id"])[0]
    assert step["outcome"] == "cancelled"
    b_run = next(r for r in store.runs if r["program_name"] == "B")
    assert b_run["status"] == "cancelled"
    assert len(scheduler._queue) == 0


async def test_manual_zone_start_cancels_quick_run(store, irrigation, clock):
    store.add_quick_run_request([{"zone_id": 1, "minutes": 30}], "drew@example.com")
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)  # quick run starts

    await scheduler.on_manual_start(minutes=5)
    await drain()

    run = store.run(store.runs[0]["id"])
    assert run["status"] == "cancelled"
    assert run["program_id"] is None
    assert "manual" in run["note"]


# ---------------------------------------------------- Q.E5: malformed payload


MALFORMED_PAYLOADS = {
    "empty_array": [],
    "not_a_list": {"zone_id": 1, "minutes": 5},
    "too_many_steps": [{"zone_id": 1, "minutes": 1}] * (QUICK_RUN_MAX_STEPS + 1),
    "minutes_zero": [{"zone_id": 1, "minutes": 0}],
    "minutes_too_high": [{"zone_id": 1, "minutes": 241}],
    "minutes_not_int": [{"zone_id": 1, "minutes": "10"}],
    "minutes_bool": [{"zone_id": 1, "minutes": True}],
    "zone_id_not_int": [{"zone_id": "1", "minutes": 10}],
    "zone_id_bool": [{"zone_id": True, "minutes": 10}],
    "missing_minutes": [{"zone_id": 1}],
    "entry_not_dict": [1, 2, 3],
    "null_payload": None,
}


@pytest.mark.parametrize("payload", MALFORMED_PAYLOADS.values(), ids=MALFORMED_PAYLOADS.keys())
async def test_quick_run_malformed_payload_ignored_no_crash(
    store, irrigation, clock, payload
):
    request_id = store.add_quick_run_request(payload, "drew@example.com")
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)  # must not raise

    assert store.runs == []  # nothing recorded
    assert irrigation.calls == []
    claimed = next(r for r in store.run_requests if r["id"] == request_id)
    assert claimed["claimed_at"] is not None  # stays claimed: not retried forever

    # A subsequent, well-formed tick still works fine (never crashed the tick).
    await tick(scheduler)
    assert store.runs == []


@pytest.mark.parametrize(
    "payload,expected",
    [
        ([{"zone_id": 1, "minutes": 10}], (1,)),
        ([{"zone_id": 3, "minutes": 5}, {"zone_id": 1, "minutes": 10}], (2,)),
    ],
)
def test_parse_quick_run_steps_valid(payload, expected):
    steps = parse_quick_run_steps(payload)
    assert steps is not None
    assert len(steps) == expected[0]
    assert [s.position for s in steps] == list(range(len(steps)))


@pytest.mark.parametrize("payload", MALFORMED_PAYLOADS.values(), ids=MALFORMED_PAYLOADS.keys())
def test_parse_quick_run_steps_malformed(payload):
    assert parse_quick_run_steps(payload) is None


def test_parse_quick_run_steps_boundary_minutes_and_step_count():
    assert parse_quick_run_steps([{"zone_id": 1, "minutes": 1}]) is not None
    assert parse_quick_run_steps([{"zone_id": 1, "minutes": 240}]) is not None
    assert (
        parse_quick_run_steps([{"zone_id": 1, "minutes": 1}] * QUICK_RUN_MAX_STEPS)
        is not None
    )


# --------------------------------------------------------------- Q.E6: status


async def test_status_reflects_quick_run(store, irrigation, clock):
    store.add_quick_run_request(
        [{"zone_id": 3, "minutes": 10}, {"zone_id": 1, "minutes": 5}],
        "drew@example.com",
    )
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)

    program_run, _ = scheduler.status_extras()
    assert program_run["run_id"] == store.runs[0]["id"]
    assert program_run["program_name"] == QUICK_RUN_NAME
    assert program_run["step_position"] == 0
    assert program_run["step_zone_id"] == 3
    assert program_run["step_remaining_seconds"] == 600
    assert program_run["total_steps"] == 2

    await clock.advance(600)  # step 0 elapses -> step 1 begins
    program_run, _ = scheduler.status_extras()
    assert program_run["step_position"] == 1
    assert program_run["step_zone_id"] == 1
    assert program_run["step_remaining_seconds"] == 300

    await clock.advance(300)  # run completes
    program_run, _ = scheduler.status_extras()
    assert program_run is None


# ---------------------------------------------------- regression: run-now/program


async def test_program_run_now_unaffected_by_quick_run_changes(store, irrigation, clock):
    """Program-based run_requests (no steps) still behave exactly as before:
    program_id set, initiator = requested_by, admitted like run-now."""
    store.programs = [make_program(program_id=1, name="A", steps=((1, 10),))]
    store.add_run_request(1, "drew@example.com")
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]
    run = store.runs[0]
    assert run["program_id"] == 1
    assert run["program_name"] == "A"
    assert run["initiator"] == "drew@example.com"
    assert run["scheduled_for"] is None
