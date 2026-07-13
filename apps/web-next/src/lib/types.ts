// Shared shapes between the internal API routes and the client components.
// The executor contract lives in docs/API.md; these are the app's merged views.

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

export interface ExecutorStatus {
  controller: ControllerInfo;
  zones: ExecutorZone[];
  rain_sensor_active: boolean;
  rain_delay_days: number;
  reachable: boolean;
  cached_at: string | null;
  program_run: ExecutorProgramRun | null;
  next_scheduled: ExecutorNextScheduled | null;
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

export interface ActiveZonesResponse {
  active_zones: number[];
}

export interface RainDelayResponse {
  days: number;
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
