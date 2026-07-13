"""Shared fixtures: fake controller + app wired against it (no network)."""

import asyncio
import time
from types import SimpleNamespace

import httpx
import pytest
from pyrainbird.exceptions import RainbirdApiException

from app.config import Settings
from app.main import create_app
from app.rainbird import RainbirdService
from app.zone_names import ZoneNameStore

ZONE_COUNT = 7


class FakeStates:
    def __init__(self, active: set[int]) -> None:
        self._active = set(active)

    def active(self, number: int) -> bool:
        return number in self._active


class FakeController:
    """In-memory stand-in for AsyncRainbirdController.

    Records (method, start, end) monotonic timestamps for every call so tests
    can assert the serialization/pacing invariant (NFR N1).
    """

    def __init__(self, latency: float = 0.02) -> None:
        self.latency = latency
        self.unreachable = False
        self.active_zones: set[int] = set()
        self.rain_delay = 0
        self.rain_sensor = False
        self.calls: list[tuple[str, float, float]] = []
        self._in_flight = 0
        self.max_in_flight = 0

    async def _do(self, method: str):
        if self.unreachable:
            raise RainbirdApiException("Error communicating with Rain Bird device")
        self._in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self._in_flight)
        start = time.monotonic()
        await asyncio.sleep(self.latency)
        end = time.monotonic()
        self._in_flight -= 1
        self.calls.append((method, start, end))

    def call_count(self, method: str) -> int:
        return sum(1 for m, _, _ in self.calls if m == method)

    async def get_model_and_version(self):
        await self._do("get_model_and_version")
        return SimpleNamespace(model_name="ESP-Me", major="2", minor="9")

    async def get_serial_number(self) -> str:
        await self._do("get_serial_number")
        return "4769753604227727360"

    async def get_available_stations(self):
        await self._do("get_available_stations")
        return SimpleNamespace(active_set=set(range(1, ZONE_COUNT + 1)))

    async def get_zone_states(self):
        await self._do("get_zone_states")
        return FakeStates(self.active_zones)

    async def get_rain_sensor_state(self) -> bool:
        await self._do("get_rain_sensor_state")
        return self.rain_sensor

    async def get_rain_delay(self) -> int:
        await self._do("get_rain_delay")
        return self.rain_delay

    async def irrigate_zone(self, zone: int, minutes: int) -> None:
        await self._do("irrigate_zone")
        self.active_zones = {zone}  # controller switches, one zone at a time

    async def stop_irrigation(self) -> None:
        await self._do("stop_irrigation")
        self.active_zones = set()

    async def set_rain_delay(self, days: int) -> None:
        await self._do("set_rain_delay")
        self.rain_delay = days


@pytest.fixture
def fake_controller() -> FakeController:
    return FakeController()


@pytest.fixture
def zone_names_file(tmp_path):
    return tmp_path / "zone_names.json"


@pytest.fixture
def settings(zone_names_file) -> Settings:
    return Settings(
        rainbird_host="127.0.0.1",
        rainbird_password="test",
        zone_names_file=str(zone_names_file),
        cors_origins="*",
    )


@pytest.fixture
def service(settings, zone_names_file, fake_controller) -> RainbirdService:
    return RainbirdService(
        host=settings.rainbird_host,
        password=settings.rainbird_password,
        zone_names=ZoneNameStore(zone_names_file),
        controller_factory=lambda: fake_controller,
    )


@pytest.fixture
async def client(settings, service):
    app = create_app(settings=settings, service=service)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        yield client
