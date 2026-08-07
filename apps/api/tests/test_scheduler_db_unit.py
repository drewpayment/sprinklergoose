"""Wall-clock bounds on AsyncpgSchedulerStore operations (no Postgres).

asyncpg's command_timeout does not bound Pool.acquire(), so a server that
dies without closing its sockets (SIGKILL under an NFS stall) can wedge the
pool — and, through it, the scheduler loop — forever. These tests drive the
store against stub pools to pin the _op() contract: every operation is
bounded, a timed-out pool is terminated and discarded, and both errors and
results pass through unchanged.
"""

import asyncio

import pytest

from app.scheduler_db import AsyncpgSchedulerStore


class StubPool:
    def __init__(self) -> None:
        self.terminated = False

    def terminate(self) -> None:
        self.terminated = True


class WedgedPool(StubPool):
    async def fetch(self, *args):
        await asyncio.Event().wait()  # blocks forever, like a dead server


class FailingPool(StubPool):
    async def fetch(self, *args):
        raise RuntimeError("boom")


class HealthyPool(StubPool):
    async def fetch(self, query, *args):
        return [{"id": 1, "name": "Front porch", "enabled": True}]


def make_store(pool: StubPool, timeout: float = 0.05) -> AsyncpgSchedulerStore:
    store = AsyncpgSchedulerStore("postgresql://unused", timeout=timeout)
    store._pool = pool
    return store


async def test_wedged_operation_times_out_and_discards_pool():
    pool = WedgedPool()
    store = make_store(pool)
    with pytest.raises(TimeoutError):
        await store.fetch_zones()
    assert pool.terminated
    assert store._pool is None  # next call starts from a fresh pool


async def test_operation_errors_propagate_and_keep_pool():
    pool = FailingPool()
    store = make_store(pool)
    with pytest.raises(RuntimeError):
        await store.fetch_zones()
    assert not pool.terminated
    assert store._pool is pool


async def test_result_passes_through():
    store = make_store(HealthyPool())
    zones = await store.fetch_zones()
    assert zones[1].name == "Front porch"
    assert zones[1].enabled
