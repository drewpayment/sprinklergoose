"""Pydantic schemas for the API contract (docs/API.md)."""

from pydantic import BaseModel, Field


class ControllerInfo(BaseModel):
    model: str
    firmware: str
    serial: str


class Zone(BaseModel):
    id: int
    name: str
    active: bool
    remaining_seconds: int | None = None
    # True for all zones when no DATABASE_URL is configured (v1 back-compat).
    enabled: bool = True


class ProgramRunInfo(BaseModel):
    """The scheduler's currently executing program run (M2)."""

    run_id: int
    program_name: str
    step_position: int
    step_zone_id: int
    step_remaining_seconds: int
    total_steps: int


class NextScheduledInfo(BaseModel):
    """The next scheduled occurrence within the 7-day horizon (M2)."""

    program_name: str
    at: str  # ISO 8601, executor-local timezone


class StatusResponse(BaseModel):
    controller: ControllerInfo
    zones: list[Zone]
    rain_sensor_active: bool
    rain_delay_days: int
    reachable: bool
    cached_at: str | None = None
    # M2 additions — always null when no scheduler is configured (no DATABASE_URL).
    program_run: ProgramRunInfo | None = None
    next_scheduled: NextScheduledInfo | None = None


class StartZoneRequest(BaseModel):
    minutes: int = Field(ge=1, le=240)


class RenameZoneRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)


class ActiveZonesResponse(BaseModel):
    active_zones: list[int]


class RainDelay(BaseModel):
    days: int = Field(ge=0, le=14)
