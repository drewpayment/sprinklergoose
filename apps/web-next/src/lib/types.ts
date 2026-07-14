// Shared shapes between the internal API routes and the client components.
// The executor contract lives in docs/API.md; these are the app's merged views.

import type { ZoneGeometry } from "@/db/schema";
export type { ZoneGeometry, ZonePoint, ZonePolygon } from "@/db/schema";

export interface ControllerInfo {
  model: string;
  firmware: string;
  serial: string;
}

/** Executor's zone status (docs/API.md GET /api/status). */
export interface ExecutorZone {
  id: number;
  name: string;
  active: boolean;
  remaining_seconds: number | null;
}

/** Executor's active program run (docs/M2-SPEC.md GET /api/status). */
export interface ExecutorProgramRun {
  run_id: number;
  program_name: string;
  step_position: number;
  step_zone_id: number;
  step_remaining_seconds: number;
  total_steps: number;
}

/** Executor's next scheduled occurrence (next 7 days horizon; ISO time). */
export interface ExecutorNextScheduled {
  program_name: string;
  at: string;
}

/** Executor's cached weather snapshot (docs/M3-SPEC.md GET /api/status). */
export interface ExecutorWeather {
  fetched_at: string;
  past24_mm: number;
  next6_mm: number;
  current_temp_c: number;
  enabled: boolean;
}

export interface ExecutorStatus {
  controller: ControllerInfo;
  zones: ExecutorZone[];
  rain_sensor_active: boolean;
  rain_delay_days: number;
  reachable: boolean;
  cached_at: string | null;
  program_run: ExecutorProgramRun | null;
  next_scheduled: ExecutorNextScheduled | null;
  weather: ExecutorWeather | null;
}

/** Executor live state merged with app-owned zone config (name, enabled). */
export interface DashboardZone {
  id: number;
  name: string;
  enabled: boolean;
  active: boolean;
  remaining_seconds: number | null;
}

export interface DashboardStatus {
  controller: ControllerInfo;
  zones: DashboardZone[];
  rain_sensor_active: boolean;
  rain_delay_days: number;
  reachable: boolean;
  cached_at: string | null;
  program_run: ExecutorProgramRun | null;
  next_scheduled: ExecutorNextScheduled | null;
  weather: ExecutorWeather | null;
}

// ---------------------------------------------------------------------------
// M2 scheduling (docs/M2-SPEC.md)

export type DayType = "days_of_week" | "interval";

export interface ProgramStepView {
  id: number;
  position: number;
  zone_id: number;
  minutes: number;
  /** Joined from the zones table; null if the zone row is missing. */
  zone_name: string | null;
  zone_enabled: boolean;
}

export interface ProgramView {
  id: number;
  name: string;
  enabled: boolean;
  /** "HH:MM" local wall times, sorted. */
  start_times: string[];
  day_type: DayType;
  /** 0=Mon .. 6=Sun. */
  days_of_week: number[] | null;
  interval_days: number | null;
  /** "YYYY-MM-DD". */
  anchor_date: string | null;
  respect_rain_delay: boolean;
  updated_at: string;
  steps: ProgramStepView[];
}

/** Create/update payload; steps are ordered (position = array index). */
export interface ProgramInput {
  name: string;
  enabled: boolean;
  start_times: string[];
  day_type: DayType;
  days_of_week: number[] | null;
  interval_days: number | null;
  anchor_date: string | null;
  respect_rain_delay: boolean;
  steps: { zone_id: number; minutes: number }[];
}

export const RUN_STATUSES = [
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "skipped_rain_delay",
  "skipped_weather",
  "missed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export type StepOutcome =
  | "completed"
  | "cancelled"
  | "failed"
  | "skipped_disabled";

export interface HistoryRunStep {
  id: number;
  position: number;
  zone_id: number;
  zone_name: string;
  planned_minutes: number;
  started_at: string | null;
  finished_at: string | null;
  outcome: StepOutcome | null;
}

export interface HistoryRun {
  id: number;
  program_id: number | null;
  program_name: string;
  scheduled_for: string | null;
  initiator: string;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  note: string | null;
  /**
   * Whether the program still exists AND is enabled right now (M3: gates the
   * "Water anyway" button on skipped rows). Null when the program was deleted.
   */
  program_enabled: boolean | null;
  steps: HistoryRunStep[];
}

export interface HistoryResponse {
  runs: HistoryRun[];
  total: number;
  page: number;
  page_size: number;
}

export interface RunNowResponse {
  request_id: number;
}

// ---------------------------------------------------------------------------
// M3.Q Quick Run (docs/M3-SPEC.md) — ad-hoc multi-zone run, no program.

export interface QuickRunStepInput {
  zone_id: number;
  minutes: number;
}

/** POST /api/quick-run payload; array order = run order. */
export interface QuickRunInput {
  steps: QuickRunStepInput[];
}

export type QuickRunResponse = RunNowResponse;

// ---------------------------------------------------------------------------
// M3 weather (docs/M3-SPEC.md)

/** The app's view of the weather_settings singleton (GET/PUT payload). */
export interface WeatherSettingsView {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  rain_lookback_mm: number;
  forecast_lookahead_mm: number;
  freeze_temp_c: number;
  updated_at: string;
}

/** PUT payload — forecast_probability is reserved for M3.1, not exposed. */
export interface WeatherSettingsInput {
  enabled: boolean;
  latitude: number | null;
  longitude: number | null;
  rain_lookback_mm: number;
  forecast_lookahead_mm: number;
  freeze_temp_c: number;
}

export interface ActiveZonesResponse {
  active_zones: number[];
}

export interface RainDelayResponse {
  days: number;
}

// ---------------------------------------------------------------------------
// M4.M zone map + weather forecast (docs/M4-MAP-SPEC.md)

/** The app's view of a zone for the map page: config + placement. */
export interface ZoneMapView {
  id: number;
  name: string;
  enabled: boolean;
  geometry: ZoneGeometry | null;
}

export interface ForecastWeather {
  fetched_at: string;
  past24_mm: number;
  next6_mm: number;
  current_temp_c: number;
}

export interface ForecastHourlyPoint {
  /** UTC ISO timestamp. */
  time: string;
  precip_mm: number;
  temp_c: number;
}

export type ForecastPrediction =
  | "watering"
  | "skip_rain"
  | "skip_forecast"
  | "skip_freeze"
  | "rain_delay"
  | "unknown";

export interface ForecastUpcomingRun {
  program_id: number;
  program_name: string;
  /** Executor local time with offset, e.g. "2026-07-14T06:00:00-04:00". */
  at: string;
  prediction: ForecastPrediction;
  note: string | null;
}

/** GET /api/forecast response (executor GET /api/forecast, proxied). */
export interface ForecastResponse {
  enabled: boolean;
  weather: ForecastWeather | null;
  hourly: ForecastHourlyPoint[];
  upcoming: ForecastUpcomingRun[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}
