"""FastAPI application implementing docs/API.md."""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .models import (
    ActiveZonesResponse,
    ForecastResponse,
    ForecastWeather,
    HourlyPoint,
    NextScheduledInfo,
    ProgramRunInfo,
    RainDelay,
    RenameZoneRequest,
    StartZoneRequest,
    StatusResponse,
    UpcomingRun,
    WeatherInfo,
    Zone,
)
from .rainbird import ControllerUnreachableError, RainbirdService, UnknownZoneError
from .scheduler import Scheduler
from .zone_config import (
    AsyncpgZoneConfigSource,
    ZoneConfigUnavailableError,
    ZoneEnablement,
)
from .zone_names import ZoneNameStore

DETAIL_UNREACHABLE = "controller unreachable"
DETAIL_UNKNOWN_ZONE = "unknown zone"
DETAIL_ZONE_DISABLED = "zone disabled"
DETAIL_ZONE_CONFIG_UNAVAILABLE = "zone config unavailable"


def create_app(
    settings: Settings | None = None,
    service: RainbirdService | None = None,
    zone_enablement: ZoneEnablement | None = None,
    scheduler: Scheduler | None = None,
) -> FastAPI:
    settings = settings or Settings()
    if service is None:
        service = RainbirdService(
            host=settings.rainbird_host,
            password=settings.rainbird_password,
            zone_names=ZoneNameStore(settings.zone_names_file),
        )
    if zone_enablement is None and settings.database_url:
        zone_enablement = ZoneEnablement(AsyncpgZoneConfigSource(settings.database_url))
    enablement = zone_enablement  # None ⇒ exact v1 behavior (no DB configured)
    if scheduler is None and settings.database_url:
        from .scheduler_db import AsyncpgSchedulerStore
        from .weather import OpenMeteoWeatherSource

        scheduler = Scheduler(
            store=AsyncpgSchedulerStore(settings.database_url),
            service=service,
            timezone=settings.schedule_timezone,
            weather_source=OpenMeteoWeatherSource(),
        )
    sched = scheduler  # None ⇒ no scheduling (no DB configured)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if sched is not None:
            await sched.start()
        yield
        if sched is not None:
            await sched.stop()
        await service.close()
        if enablement is not None:
            await enablement.close()

    app = FastAPI(title="rainbird-api", version="1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def unreachable() -> HTTPException:
        return HTTPException(status_code=503, detail=DETAIL_UNREACHABLE)

    @app.get("/healthz")
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/status", response_model=StatusResponse)
    async def get_status() -> StatusResponse:
        try:
            status = await service.get_status()
        except ControllerUnreachableError:
            raise unreachable() from None
        if enablement is not None:
            enabled = await enablement.enabled_map()  # best-effort, never raises
            if enabled is not None:
                for zone in status.zones:
                    zone.enabled = enabled.get(zone.id, False)
        if sched is not None:
            program_run, next_scheduled = sched.status_extras()
            status.program_run = (
                ProgramRunInfo(**program_run) if program_run else None
            )
            status.next_scheduled = (
                NextScheduledInfo(**next_scheduled) if next_scheduled else None
            )
            weather = sched.weather_status()
            status.weather = WeatherInfo(**weather) if weather else None
        return status

    @app.get("/api/forecast", response_model=ForecastResponse)
    async def get_forecast() -> ForecastResponse:
        # Never 500 on missing weather (M4 E4): no scheduler configured
        # (no DATABASE_URL) means no program/weather data at all.
        if sched is None:
            return ForecastResponse(enabled=False, weather=None, hourly=[], upcoming=[])
        rain_delay_days = service.cached_rain_delay_days()
        result = sched.build_forecast(rain_delay_days)
        return ForecastResponse(
            enabled=result.enabled,
            weather=(
                ForecastWeather(
                    fetched_at=result.weather.fetched_at.isoformat(),
                    past24_mm=result.weather.past24_mm,
                    next6_mm=result.weather.next6_mm,
                    current_temp_c=result.weather.current_temp_c,
                )
                if result.weather is not None
                else None
            ),
            hourly=[
                HourlyPoint(
                    time=bucket.time.isoformat(),
                    precip_mm=bucket.precip_mm,
                    temp_c=bucket.temp_c,
                )
                for bucket in result.hourly
                if bucket.temp_c is not None
            ],
            upcoming=[
                UpcomingRun(
                    program_id=item.program_id,
                    program_name=item.program_name,
                    at=item.at.isoformat(),
                    prediction=item.prediction,
                    note=item.note,
                )
                for item in result.upcoming
            ],
        )

    @app.post("/api/zones/{zone_id}/start", response_model=ActiveZonesResponse)
    async def start_zone(zone_id: int, body: StartZoneRequest) -> ActiveZonesResponse:
        if enablement is not None:
            # Unknown ids stay 404 regardless of DB contents.
            try:
                if zone_id not in await service.known_zones():
                    raise HTTPException(
                        status_code=404, detail=DETAIL_UNKNOWN_ZONE
                    )
            except ControllerUnreachableError:
                raise unreachable() from None
            # Fail-safe gate: a start needs config at most ~5s old; a zone
            # with no row (or no answer) never waters.
            try:
                if not await enablement.is_enabled(zone_id):
                    raise HTTPException(
                        status_code=403, detail=DETAIL_ZONE_DISABLED
                    )
            except ZoneConfigUnavailableError:
                raise HTTPException(
                    status_code=503, detail=DETAIL_ZONE_CONFIG_UNAVAILABLE
                ) from None
        if sched is not None:
            # Manual always wins: cancel any scheduler-run program first, and
            # defer queued programs for the manual run's duration (M2.E3).
            await sched.on_manual_start(body.minutes)
        try:
            active = await service.start_zone(zone_id, body.minutes)
        except UnknownZoneError:
            raise HTTPException(status_code=404, detail=DETAIL_UNKNOWN_ZONE) from None
        except ControllerUnreachableError:
            raise unreachable() from None
        return ActiveZonesResponse(active_zones=active)

    @app.post("/api/zones/stop", response_model=ActiveZonesResponse)
    async def stop_all() -> ActiveZonesResponse:
        if sched is not None:
            # Cancel the active program run and clear the queue before the
            # hardware stop; the scheduler issues no module commands here.
            await sched.on_stop_all()
        try:
            active = await service.stop_all()
        except ControllerUnreachableError:
            raise unreachable() from None
        return ActiveZonesResponse(active_zones=active)

    @app.patch("/api/zones/{zone_id}", response_model=Zone)
    async def rename_zone(zone_id: int, body: RenameZoneRequest) -> Zone:
        try:
            return await service.rename_zone(zone_id, body.name)
        except UnknownZoneError:
            raise HTTPException(status_code=404, detail=DETAIL_UNKNOWN_ZONE) from None
        except ControllerUnreachableError:
            raise unreachable() from None

    @app.get("/api/rain-delay", response_model=RainDelay)
    async def get_rain_delay() -> RainDelay:
        try:
            return RainDelay(days=await service.get_rain_delay())
        except ControllerUnreachableError:
            raise unreachable() from None

    @app.put("/api/rain-delay", response_model=RainDelay)
    async def set_rain_delay(body: RainDelay) -> RainDelay:
        try:
            return RainDelay(days=await service.set_rain_delay(body.days))
        except ControllerUnreachableError:
            raise unreachable() from None

    return app


# Run with: uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000

