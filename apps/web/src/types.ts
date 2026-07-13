// Types derived from docs/API.md — the contract shared with apps/api.

export interface ControllerInfo {
  model: string
  firmware: string
  serial: string
}

export interface Zone {
  id: number
  name: string
  active: boolean
  remaining_seconds: number | null
}

export interface Status {
  controller: ControllerInfo
  zones: Zone[]
  rain_sensor_active: boolean
  rain_delay_days: number
  reachable: boolean
  /** Present when reachable=false: timestamp of the cached zone state. */
  cached_at?: string
}

export interface ActiveZonesResponse {
  active_zones: number[]
}

export interface RainDelayResponse {
  days: number
}

/** The full REST contract. Implemented by the real client and the dev mock. */
export interface SprinklerApi {
  getStatus(): Promise<Status>
  startZone(id: number, minutes: number): Promise<ActiveZonesResponse>
  stopAll(): Promise<ActiveZonesResponse>
  renameZone(id: number, name: string): Promise<Zone>
  getRainDelay(): Promise<RainDelayResponse>
  setRainDelay(days: number): Promise<RainDelayResponse>
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: string,
  ) {
    super(detail)
    this.name = 'ApiError'
  }
}
