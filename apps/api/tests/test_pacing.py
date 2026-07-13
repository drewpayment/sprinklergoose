"""NFR N1: every module call is serialized with >=100ms spacing.

The LNK module crashes under concurrent access, so this invariant is the most
important property of the backend. We fire many concurrent API requests at a
fake controller that records call timestamps, then assert that no two calls
overlapped and that consecutive calls were spaced >=100ms apart.
"""

import asyncio

from app.rainbird import MIN_CALL_SPACING_SECONDS

# Allow a little scheduler jitter under load; asyncio.sleep never wakes early,
# but timestamp capture around the lock has ~ms noise.
TOLERANCE = 0.005


def assert_serialized_and_paced(calls: list[tuple[str, float, float]]) -> None:
    assert calls, "expected the fake controller to have been called"
    ordered = sorted(calls, key=lambda c: c[1])
    for (m1, _, end1), (m2, start2, _) in zip(ordered, ordered[1:]):
        gap = start2 - end1
        assert gap >= MIN_CALL_SPACING_SECONDS - TOLERANCE, (
            f"{m2} started {gap * 1000:.1f}ms after {m1} ended (< 100ms)"
        )


async def test_concurrent_requests_are_serialized_and_paced(client, fake_controller):
    # 10 concurrent single-call requests hammering the API at once.
    responses = await asyncio.gather(
        *(client.get("/api/rain-delay") for _ in range(10))
    )
    assert all(r.status_code == 200 for r in responses)
    assert fake_controller.max_in_flight == 1, "module saw concurrent calls"
    assert len(fake_controller.calls) == 10
    assert_serialized_and_paced(fake_controller.calls)


async def test_mixed_endpoints_are_serialized_and_paced(client, fake_controller):
    # Status (multi-call), zone start (multi-call), and rain delay all at once.
    responses = await asyncio.gather(
        client.get("/api/status"),
        client.post("/api/zones/2/start", json={"minutes": 5}),
        client.get("/api/rain-delay"),
        client.get("/api/status"),
        client.post("/api/zones/stop"),
    )
    assert all(r.status_code == 200 for r in responses)
    assert fake_controller.max_in_flight == 1
    assert_serialized_and_paced(fake_controller.calls)


async def test_sequential_calls_are_paced(client, fake_controller):
    """Back-to-back requests (not just concurrent ones) also respect spacing."""
    await client.get("/api/rain-delay")
    await client.get("/api/rain-delay")
    await client.get("/api/rain-delay")
    assert_serialized_and_paced(fake_controller.calls)
