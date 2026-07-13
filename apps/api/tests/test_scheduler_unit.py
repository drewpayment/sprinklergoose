"""M2 W1 unit tests: fake-clock scheduler semantics (M2.E1–E4, E6, E9, E10).

Every test drives Scheduler.tick() directly with a virtual clock — no real
time, no database, no controller.
"""

from datetime import UTC, date, datetime, timedelta

import pytest

from app.scheduler import (
    INITIATOR_SCHEDULE,
    Scheduler,
    next_occurrence,
    occurrences_between,
)
from .scheduler_testkit import (
    TZ,
    FakeClock,
    FakeIrrigation,
    FakeSchedulerStore,
    drain,
    local,
    make_program,
)


@pytest.fixture
def store() -> FakeSchedulerStore:
    return FakeSchedulerStore()


@pytest.fixture
def irrigation() -> FakeIrrigation:
    return FakeIrrigation()


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock(local(5, 59, 58))  # just before the default 06:00 program


def make_scheduler(store, irrigation, clock, **kwargs) -> Scheduler:
    # A short lookback keeps the previous day's occurrences (which the real
    # 24h default would backfill as `missed` — see
    # test_occurrence_older_than_10min_recorded_missed) out of unit tests
    # that only exercise the current morning.
    kwargs.setdefault("lookback", timedelta(hours=2))
    return Scheduler(
        store=store, service=irrigation, clock=clock, timezone="America/Detroit", **kwargs
    )


async def tick(scheduler: Scheduler) -> None:
    await scheduler.tick()
    await drain()


# ------------------------------------------------------------- M2.E1: firing


async def test_due_program_fires_on_next_tick(store, irrigation, clock):
    store.programs = [make_program(steps=((1, 10),))]
    scheduler = make_scheduler(store, irrigation, clock)

    await tick(scheduler)
    assert irrigation.start_calls() == []  # 05:59:58 — not due yet

    await clock.advance(4)  # 06:00:02
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]
    run = store.runs[0]
    assert run["status"] == "running"
    assert run["initiator"] == INITIATOR_SCHEDULE
    assert run["scheduled_for"] == local(6, 0).astimezone(UTC)
    # E1: started within 60s of the occurrence.
    assert (run["started_at"] - run["scheduled_for"]).total_seconds() <= 60


async def test_steps_run_sequentially_then_stop(store, irrigation, clock):
    store.programs = [make_program(steps=((1, 10), (3, 5)))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]
    assert irrigation.stop_count() == 0  # no stop between steps

    await clock.advance(600)  # step 0 duration elapses -> step 1 starts (switch)
    assert irrigation.start_calls() == [(1, 10), (3, 5)]
    assert irrigation.stop_count() == 0

    await clock.advance(300)  # final step elapses -> stop_irrigation
    assert irrigation.stop_count() == 1
    run = store.runs[0]
    assert run["status"] == "completed"
    steps = store.steps_for(run["id"])
    assert [s["outcome"] for s in steps] == ["completed", "completed"]
    assert steps[0]["finished_at"] <= steps[1]["started_at"]  # strictly sequential
    assert all(s["started_at"] and s["finished_at"] for s in steps)


async def test_program_with_multiple_start_times(store, irrigation, clock):
    store.programs = [make_program(times=("06:00", "06:30"), steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(60)  # run for 06:00 completes
    await clock.advance(30 * 60)  # 06:30:58ish
    await tick(scheduler)
    await clock.advance(60)
    assert len(store.runs_with("completed")) == 2
    occurrences = {r["scheduled_for"] for r in store.runs}
    assert occurrences == {
        local(6, 0).astimezone(UTC),
        local(6, 30).astimezone(UTC),
    }


async def test_disabled_program_never_fires(store, irrigation, clock):
    store.programs = [make_program(enabled=False)]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    assert store.runs == []
    assert irrigation.calls == []


async def test_program_with_no_steps_never_fires(store, irrigation, clock):
    store.programs = [make_program(steps=())]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    assert store.runs == []


# ------------------------------------------------- dedupe / restart (M2.E9)


async def test_completed_occurrence_not_refired_same_process(store, irrigation, clock):
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(60)
    assert len(store.runs) == 1

    await tick(scheduler)
    await clock.advance(30)
    await tick(scheduler)
    assert len(store.runs) == 1  # still just the one row
    assert irrigation.start_calls() == [(1, 1)]


async def test_restart_does_not_double_fire(store, irrigation, clock):
    store.programs = [make_program(steps=((1, 1),))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(60)
    assert store.runs[0]["status"] == "completed"

    # "Restart": a brand-new scheduler over the same store, 3 minutes later.
    # The run row is the watermark — nothing in memory carries over.
    irrigation2 = FakeIrrigation()
    scheduler2 = make_scheduler(store, irrigation2, clock)
    await clock.advance(180)
    await tick(scheduler2)
    assert len(store.runs) == 1
    assert irrigation2.calls == []


async def test_orphaned_running_row_finalized_on_startup(store, irrigation, clock):
    occurrence = local(5, 30).astimezone(UTC)
    run_id = store.seed_running_run(1, "Lawn", occurrence, occurrence)
    store.programs = [make_program(steps=((1, 10),))]
    scheduler = make_scheduler(store, irrigation, clock)

    await tick(scheduler)
    run = store.run(run_id)
    assert run["status"] == "cancelled"
    assert "restarted" in run["note"]
    assert run["finished_at"] is not None
    step = store.steps_for(run_id)[0]
    assert step["outcome"] == "cancelled"
    assert step["finished_at"] is not None
    # The finalized row is still the watermark: 05:30 is not re-fired.
    await clock.advance(4)
    await tick(scheduler)
    assert all(r["scheduled_for"] != occurrence or r["id"] == run_id for r in store.runs)
    assert irrigation.start_calls() == [(1, 10)]  # only the 06:00 occurrence


async def test_no_fire_before_watermark_loaded(store, irrigation, clock):
    """If the DB cannot be read at startup the scheduler must not fire —
    an unknown watermark could double-fire."""
    store.programs = [make_program()]
    store.fail_writes = True
    store.fail_reads = True
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    assert irrigation.calls == []

    store.fail_writes = False
    store.fail_reads = False
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]


# ------------------------------------------------------------ missed (>10min)


async def test_occurrence_older_than_10min_recorded_missed(store, irrigation, clock):
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(15 * 60 + 2)  # 06:15 — executor "was down"
    await tick(scheduler)
    assert irrigation.calls == []
    run = store.runs[0]
    assert run["status"] == "missed"
    assert run["scheduled_for"] == local(6, 0).astimezone(UTC)
    assert "missed" in run["note"]
    # Recorded once, not every tick.
    await tick(scheduler)
    assert len(store.runs) == 1


async def test_occurrence_within_grace_still_fires(store, irrigation, clock):
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(9 * 60)  # 06:08:58 — 8m58s late, inside the 10min grace
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]
    assert store.runs[0]["status"] == "running"


async def test_occurrences_predating_program_update_not_backfilled(
    store, irrigation, clock
):
    """A program created/edited after an occurrence must not spawn a missed
    row for it (the occurrence predates the configuration)."""
    store.programs = [
        make_program(updated_at=local(6, 5).astimezone(UTC))  # created 06:05
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(20 * 60)  # 06:19:58
    await tick(scheduler)
    assert store.runs == []
    assert irrigation.calls == []


# ----------------------------------------------------- rain delay (M2.E4)


async def test_rain_delay_skips_run_no_module_commands(store, irrigation, clock):
    irrigation.rain_delay = 2
    store.programs = [make_program(respect_rain_delay=True)]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    run = store.runs[0]
    assert run["status"] == "skipped_rain_delay"
    assert "2 days" in run["note"]
    assert irrigation.start_calls() == []
    assert irrigation.stop_count() == 0
    # Skip row is the watermark too: no refire.
    await tick(scheduler)
    assert len(store.runs) == 1


async def test_rain_delay_ignored_when_not_respected(store, irrigation, clock):
    irrigation.rain_delay = 2
    store.programs = [make_program(respect_rain_delay=False)]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]


async def test_run_now_overrides_rain_delay(store, irrigation, clock):
    """Explicit human intent wins over rain delay (mirrors M3's override)."""
    irrigation.rain_delay = 3
    store.programs = [make_program(respect_rain_delay=True)]
    store.add_run_request(1, "drew@example.com")
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]
    run = store.runs[0]
    assert run["initiator"] == "drew@example.com"
    assert run["scheduled_for"] is None


async def test_unreadable_rain_delay_waters_anyway(store, irrigation, clock):
    irrigation.rain_delay_error = True
    store.programs = [make_program()]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    assert irrigation.start_calls() == [(1, 10)]


# ------------------------------------------- disabled zones & failures (E6)


async def test_disabled_zone_skipped_run_completed_with_note(store, irrigation, clock):
    store.programs = [make_program(steps=((6, 5), (1, 10)))]  # zone 6 disabled
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(600)
    run = store.runs[0]
    assert run["status"] == "completed"  # skips alone stay completed
    assert "Zone 6" in run["note"]
    steps = store.steps_for(run["id"])
    assert steps[0]["outcome"] == "skipped_disabled"
    assert steps[0]["started_at"] is None
    assert steps[1]["outcome"] == "completed"
    assert irrigation.start_calls() == [(1, 10)]  # zone 6 never touched


async def test_missing_zone_row_treated_as_disabled(store, irrigation, clock):
    del store.zones[3]
    store.programs = [make_program(steps=((3, 5), (1, 10)))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(600)
    run = store.runs[0]
    assert run["status"] == "completed"
    assert store.steps_for(run["id"])[0]["outcome"] == "skipped_disabled"
    assert (3, 5) not in irrigation.start_calls()


async def test_step_failure_after_retry_run_partial(store, irrigation, clock):
    irrigation.fail_start[3] = 2  # both attempts fail
    store.programs = [make_program(steps=((3, 5), (1, 10)))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(600)
    run = store.runs[0]
    assert run["status"] == "partial"
    assert "failed" in run["note"]
    steps = store.steps_for(run["id"])
    assert steps[0]["outcome"] == "failed"
    assert steps[1]["outcome"] == "completed"
    # Exactly two attempts on zone 3 (one retry), then moved on.
    attempts = [c for c in irrigation.calls if c[0] == "start_fail"]
    assert len(attempts) == 2


async def test_step_retry_succeeds_run_completed(store, irrigation, clock):
    irrigation.fail_start[1] = 1  # first attempt fails, retry succeeds
    store.programs = [make_program(steps=((1, 10),))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(600)
    run = store.runs[0]
    assert run["status"] == "completed"
    assert run["note"] is None
    assert irrigation.start_calls() == [(1, 10)]


async def test_every_step_failed_run_failed_no_stop(store, irrigation, clock):
    irrigation.fail_start[1] = 2
    irrigation.fail_start[2] = 2
    store.programs = [make_program(steps=((1, 5), (2, 5)))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    run = store.runs[0]
    assert run["status"] == "failed"
    assert irrigation.stop_count() == 0  # nothing started, nothing to stop


# --------------------------------------------------- queueing (FIFO/cap/now)


def _long_runner(program_id: int, name: str, hour: int, minute: int = 0) -> object:
    return make_program(
        program_id=program_id,
        name=name,
        times=(f"{hour:02d}:{minute:02d}",),
        steps=((1, 30),),
    )


async def test_queue_fifo_while_run_active(store, irrigation, clock):
    store.programs = [
        _long_runner(1, "A", 6),
        make_program(program_id=2, name="B", times=("06:01",), steps=((2, 1),)),
        make_program(program_id=3, name="C", times=("06:02",), steps=((3, 1),)),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)  # A starts (30 min)
    await clock.advance(180)  # 06:03
    await tick(scheduler)  # B and C evaluated -> queued, A still running
    assert [r["program_name"] for r in store.runs] == ["A"]

    await clock.advance(27 * 60 + 30)  # A's step elapses; A completes
    await tick(scheduler)  # B dequeues
    await clock.advance(90)
    await tick(scheduler)  # C dequeues
    await clock.advance(90)
    assert [r["program_name"] for r in store.runs] == ["A", "B", "C"]
    assert [r["status"] for r in store.runs] == ["completed"] * 3


async def test_duplicate_occurrence_of_queued_program_collapsed(
    store, irrigation, clock
):
    store.programs = [
        _long_runner(1, "A", 6),
        make_program(
            program_id=2, name="B", times=("06:01", "06:05"), steps=((2, 1),)
        ),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)  # A starts
    await clock.advance(120)  # 06:02
    await tick(scheduler)  # B(06:01) queued
    await clock.advance(240)  # 06:06
    await tick(scheduler)  # B(06:05) due while B(06:01) queued -> collapse
    collapsed = [r for r in store.runs if r["status"] == "missed"]
    assert len(collapsed) == 1
    assert collapsed[0]["scheduled_for"] == local(6, 5).astimezone(UTC)
    assert "collapsed" in collapsed[0]["note"]
    # The queued 06:01 occurrence still runs after A.
    await clock.advance(25 * 60)
    await tick(scheduler)
    await clock.advance(90)
    b_runs = [r for r in store.runs if r["program_name"] == "B" and r["status"] == "completed"]
    assert len(b_runs) == 1
    assert b_runs[0]["scheduled_for"] == local(6, 1).astimezone(UTC)


async def test_queue_cap_overflow_recorded_missed(store, irrigation, clock):
    programs = [_long_runner(1, "A", 6)]
    for i in range(2, 9):  # programs 2..8 due at 06:01..06:07
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
    await clock.advance(8 * 60)  # 06:08 — all seven now due
    await tick(scheduler)
    overflow = [r for r in store.runs if r["status"] == "missed"]
    assert len(overflow) == 2  # cap 5: P7, P8 overflow
    assert all("queue full" in r["note"] for r in overflow)
    assert len(scheduler._queue) == 5


async def test_run_now_jumps_queue_but_fifo_among_run_nows(store, irrigation, clock):
    store.programs = [
        _long_runner(1, "A", 6),
        make_program(program_id=2, name="B", times=("06:01",), steps=((2, 1),)),
        make_program(program_id=3, name="C", times=("23:00",), steps=((3, 1),)),
        make_program(program_id=4, name="D", times=("23:30",), steps=((4, 1),)),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)  # A starts
    await clock.advance(120)
    await tick(scheduler)  # B queued
    store.add_run_request(3, "one@example.com")
    store.add_run_request(4, "two@example.com")
    scheduler._on_notify()  # web NOTIFYs after writing run_requests
    await tick(scheduler)  # claims both -> [C, D, B]
    assert [i.program_name for i in scheduler._queue] == ["C", "D", "B"]

    await clock.advance(28 * 60)  # A finishes
    await tick(scheduler)
    await clock.advance(90)
    await tick(scheduler)
    await clock.advance(90)
    await tick(scheduler)
    await clock.advance(90)
    finished = [r["program_name"] for r in store.runs if r["status"] == "completed"]
    assert finished == ["A", "C", "D", "B"]
    c_run = next(r for r in store.runs if r["program_name"] == "C")
    assert c_run["initiator"] == "one@example.com"
    assert c_run["scheduled_for"] is None


async def test_run_request_claimed_exactly_once(store, irrigation, clock):
    store.programs = [make_program(program_id=1, name="A", times=("23:00",))]
    store.add_run_request(1, "drew@example.com")
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)  # claims + runs
    assert store.run_requests[0]["claimed_at"] is not None
    await clock.advance(600 + 30)
    await tick(scheduler)
    runs = [r for r in store.runs if r["initiator"] == "drew@example.com"]
    assert len(runs) == 1  # claimed once, run once


async def test_deleted_program_queued_item_dropped(store, irrigation, clock):
    store.programs = [
        _long_runner(1, "A", 6),
        make_program(program_id=2, name="B", times=("06:01",), steps=((2, 1),)),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    await clock.advance(120)
    await tick(scheduler)  # B queued
    store.programs = [_long_runner(1, "A", 6)]  # B deleted in the web app
    scheduler._on_notify()
    await tick(scheduler)  # refresh picks up deletion
    await clock.advance(28 * 60)  # A finishes
    await tick(scheduler)
    await clock.advance(120)
    assert [r["program_name"] for r in store.runs if r["status"] == "completed"] == ["A"]
    assert not any(r["program_name"] == "B" for r in store.runs)


# --------------------------------------------------- cancellation (M2.E3)


async def test_stop_all_cancels_run_and_clears_queue(store, irrigation, clock):
    store.programs = [
        _long_runner(1, "A", 6),
        make_program(program_id=2, name="B", times=("06:01",), steps=((2, 1),)),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)  # A starts
    await clock.advance(120)
    await tick(scheduler)  # B queued
    stops_before = irrigation.stop_count()

    await scheduler.on_stop_all()
    await drain()

    a_run = next(r for r in store.runs if r["program_name"] == "A")
    assert a_run["status"] == "cancelled"
    assert "stop-all" in a_run["note"]
    step = store.steps_for(a_run["id"])[0]
    assert step["outcome"] == "cancelled"
    assert step["finished_at"] is not None
    b_run = next(r for r in store.runs if r["program_name"] == "B")
    assert b_run["status"] == "cancelled"
    assert "queue cleared" in b_run["note"]
    assert len(scheduler._queue) == 0
    # The scheduler itself issues no module commands on the cancel path —
    # the stop endpoint owns the hardware stop.
    assert irrigation.stop_count() == stops_before

    # Neither occurrence refires: the cancelled rows are the watermark.
    await tick(scheduler)
    await clock.advance(60)
    await tick(scheduler)
    assert len(store.runs) == 2
    assert irrigation.start_calls() == [(1, 30)]


async def test_manual_start_cancels_run_and_defers_queue(store, irrigation, clock):
    store.programs = [
        _long_runner(1, "A", 6),
        make_program(program_id=2, name="B", times=("06:01",), steps=((2, 1),)),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)  # A starts
    await clock.advance(120)
    await tick(scheduler)  # B queued

    await scheduler.on_manual_start(minutes=5)  # user starts a zone by hand
    await drain()
    a_run = next(r for r in store.runs if r["program_name"] == "A")
    assert a_run["status"] == "cancelled"
    assert "manual" in a_run["note"]
    # Queue kept, but deferred while the manual zone runs.
    assert [i.program_name for i in scheduler._queue] == ["B"]
    await tick(scheduler)
    assert not any(r["program_name"] == "B" for r in store.runs)

    await clock.advance(5 * 60 + 1)  # manual run's duration elapses
    await tick(scheduler)
    await clock.advance(90)
    b_run = next(r for r in store.runs if r["program_name"] == "B")
    assert b_run["status"] == "completed"


async def test_manual_start_with_no_active_run_still_defers(store, irrigation, clock):
    store.programs = [make_program(program_id=1, name="A", times=("06:01",), steps=((2, 1),))]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    await scheduler.on_manual_start(minutes=10)

    await clock.advance(120)  # 06:01:58 — A due, but manual zone running
    await tick(scheduler)
    assert store.runs == []
    assert [i.program_name for i in scheduler._queue] == ["A"]

    await clock.advance(9 * 60)  # manual hold expires
    await tick(scheduler)
    await clock.advance(90)
    assert store.runs[0]["program_name"] == "A"
    assert store.runs[0]["status"] == "completed"


async def test_stop_all_clears_manual_hold(store, irrigation, clock):
    store.programs = [make_program(program_id=1, name="A", times=("06:01",), steps=((2, 1),))]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    await scheduler.on_manual_start(minutes=30)
    await scheduler.on_stop_all()  # user stopped the manual zone again

    await clock.advance(130)
    await tick(scheduler)
    await clock.advance(90)
    assert store.runs[0]["program_name"] == "A"  # fired despite earlier hold


async def test_shutdown_finalizes_active_run(store, irrigation, clock):
    store.programs = [_long_runner(1, "A", 6)]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    assert store.runs[0]["status"] == "running"
    await scheduler.stop()
    assert store.runs[0]["status"] == "cancelled"
    assert "shutting down" in store.runs[0]["note"]


# ----------------------------------------------------------- DST behavior


async def test_spring_forward_nonexistent_time_runs_an_hour_later():
    """2026-03-08: 2:00→3:00 EST→EDT. A 02:30 program fires at 3:30 local
    (07:30 UTC) — documented, not agonized over."""
    store = FakeSchedulerStore()
    irrigation = FakeIrrigation()
    # 07:29 UTC == 03:29 EDT on the spring-forward morning.
    clock = FakeClock(datetime(2026, 3, 8, 7, 29, 0, tzinfo=UTC))
    store.programs = [make_program(times=("02:30",))]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    assert store.runs == []  # not due yet

    await clock.advance(120)  # 07:31 UTC
    await tick(scheduler)
    run = store.runs[0]
    assert run["status"] == "running"
    assert run["scheduled_for"] == datetime(2026, 3, 8, 7, 30, tzinfo=UTC)
    assert run["scheduled_for"].astimezone(TZ).strftime("%H:%M") == "03:30"


def test_occurrences_between_day_rules():
    tz = TZ
    window_start = datetime(2026, 7, 12, 0, 0, tzinfo=tz)  # Sunday
    window_end = datetime(2026, 7, 19, 0, 0, tzinfo=tz)

    mwf = make_program(days=(0, 2, 4), times=("06:00",))  # Mon/Wed/Fri
    occs = occurrences_between(mwf, window_start, window_end, tz)
    assert [o.astimezone(tz).strftime("%a %H:%M") for o in occs] == [
        "Mon 06:00",
        "Wed 06:00",
        "Fri 06:00",
    ]

    every3 = make_program(
        day_type="interval",
        interval_days=3,
        anchor=date(2026, 7, 13),
        times=("06:00",),
    )
    occs = occurrences_between(every3, window_start, window_end, tz)
    assert [o.astimezone(tz).date() for o in occs] == [
        date(2026, 7, 13),
        date(2026, 7, 16),
    ]

    # Dates before the anchor never match.
    future_anchor = make_program(
        day_type="interval",
        interval_days=1,
        anchor=date(2026, 8, 1),
        times=("06:00",),
    )
    assert occurrences_between(future_anchor, window_start, window_end, tz) == []


# --------------------------------------------------------- status (M2.E10)


async def test_status_extras_idle(store, irrigation, clock):
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    program_run, next_scheduled = scheduler.status_extras()
    assert program_run is None
    assert next_scheduled is None  # no programs at all


async def test_status_extras_next_scheduled(store, irrigation, clock):
    store.programs = [
        make_program(program_id=1, name="Front Beds", times=("07:00",)),
        make_program(program_id=2, name="Back Lawn", times=("06:30",)),
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    _, next_scheduled = scheduler.status_extras()
    assert next_scheduled["program_name"] == "Back Lawn"
    assert next_scheduled["at"] == local(6, 30).isoformat()


async def test_status_extras_next_scheduled_respects_7_day_horizon(
    store, irrigation, clock
):
    store.programs = [
        make_program(
            day_type="interval",
            interval_days=30,
            anchor=date(2026, 8, 1),  # 17 days out
            times=("06:00",),
        )
    ]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    _, next_scheduled = scheduler.status_extras()
    assert next_scheduled is None


async def test_status_extras_during_run_counts_down(store, irrigation, clock):
    store.programs = [make_program(name="Lawn", steps=((1, 10), (3, 5)))]
    scheduler = make_scheduler(store, irrigation, clock)
    await clock.advance(4)
    await tick(scheduler)
    program_run, _ = scheduler.status_extras()
    assert program_run["run_id"] == store.runs[0]["id"]
    assert program_run["program_name"] == "Lawn"
    assert program_run["step_position"] == 0
    assert program_run["step_zone_id"] == 1
    assert program_run["step_remaining_seconds"] == 600
    assert program_run["total_steps"] == 2

    await clock.advance(100)
    program_run, _ = scheduler.status_extras()
    assert program_run["step_remaining_seconds"] == 500

    await clock.advance(500)  # step 1 (zone 3) begins
    program_run, _ = scheduler.status_extras()
    assert program_run["step_position"] == 1
    assert program_run["step_zone_id"] == 3
    assert program_run["step_remaining_seconds"] == 300

    await clock.advance(300)  # run completes
    program_run, _ = scheduler.status_extras()
    assert program_run is None


# ---------------------------------------------- config pickup (E7 semantics)


async def test_program_change_picked_up_by_poll_interval(store, irrigation, clock):
    store.programs = [make_program(name="Old", times=("22:00",))]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    _, nxt = scheduler.status_extras()
    assert nxt["program_name"] == "Old"

    store.programs = [make_program(name="New", times=("21:00",))]
    await clock.advance(5)  # < poll interval: cached config still serves
    await tick(scheduler)
    _, nxt = scheduler.status_extras()
    assert nxt["program_name"] == "Old"

    await clock.advance(11)  # past the 15s poll interval
    await tick(scheduler)
    _, nxt = scheduler.status_extras()
    assert nxt["program_name"] == "New"


async def test_notify_forces_immediate_refresh(store, irrigation, clock):
    store.programs = [make_program(name="Old", times=("22:00",))]
    scheduler = make_scheduler(store, irrigation, clock)
    await tick(scheduler)
    store.programs = [make_program(name="New", times=("21:00",))]
    scheduler._on_notify()
    await tick(scheduler)  # immediately, well before the poll interval
    _, nxt = scheduler.status_extras()
    assert nxt["program_name"] == "New"


async def test_next_occurrence_helper_skips_disabled_and_empty():
    now = local(5, 0)
    programs = [
        make_program(program_id=1, name="Off", enabled=False, times=("06:00",)),
        make_program(program_id=2, name="Empty", steps=(), times=("06:30",)),
        make_program(program_id=3, name="Real", times=("07:00",)),
    ]
    result = next_occurrence(programs, now, timedelta(days=7), TZ)
    assert result[0] == "Real"
