"""Application settings loaded from environment variables (see docs/API.md)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-driven configuration."""

    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    rainbird_host: str = "192.168.86.173"
    rainbird_password: str
    zone_names_file: str = "./data/zone_names.json"
    cors_origins: str = "*"
    # Optional Postgres DSN for the shared `zones` table (M1 W2). Unset means
    # exact v1 behavior: no DB traffic, every zone treated as enabled.
    # When set, the M2 scheduler engine also starts (programs read from the
    # same database).
    database_url: str | None = None
    # IANA timezone for program wall times (M2). DST handled via zoneinfo.
    schedule_timezone: str = "America/Detroit"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]
