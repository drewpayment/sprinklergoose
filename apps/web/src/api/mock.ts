// In-memory mock of the full docs/API.md contract for development
// (`VITE_MOCK=1 npm run dev`). Seeds one running zone with a live countdown
// and supports a togglable "controller unreachable" state (via the MOCK badge
// in the corner of the UI, or `window.__sprinklerMock.toggle()`).
import { ApiError } from '../types'
import type {
  ActiveZonesResponse,
  RainDelayResponse,
  SprinklerApi,
  Status,
  Zone,
} from '../types'

const LATENCY_MS = 200
const ZONE_COUNT = 7

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class MockApi implements SprinklerApi {
  private names = new Map<number, string>([
    [1, 'Front beds'],
    [2, 'Back lawn'],
    [3, 'Side yard'],
  ])
  private running: { id: number; endsAt: number } | null = {
    // seed a fake running zone so the countdown UI is exercised
    id: 3,
    endsAt: Date.now() + 7 * 60 * 1000 + 24 * 1000,
  }
  private rainDelayDays = 0
  private rainSensorActive = false
  private _unreachable = false
  private cached: { zones: Zone[]; cachedAt: string } | null = null

  constructor() {
    ;(window as unknown as Record<string, unknown>).__sprinklerMock = this
  }

  get unreachable(): boolean {
    return this._unreachable
  }

  /** Toggle the fake "module unreachable" state. Returns the new value. */
  toggle(): boolean {
    this._unreachable = !this._unreachable
    if (this._unreachable) {
      this.cached = { zones: this.zones(), cachedAt: new Date().toISOString() }
    } else {
      this.cached = null
    }
    return this._unreachable
  }

  private zoneName(id: number): string {
    return this.names.get(id) ?? `Zone ${id}`
  }

  private zones(): Zone[] {
    if (this.running && this.running.endsAt <= Date.now()) this.running = null
    return Array.from({ length: ZONE_COUNT }, (_, i) => {
      const id = i + 1
      const active = this.running?.id === id
      return {
        id,
        name: this.zoneName(id),
        active,
        remaining_seconds: active
          ? Math.max(0, Math.ceil((this.running!.endsAt - Date.now()) / 1000))
          : null,
      }
    })
  }

  private failIfUnreachable(): void {
    if (this._unreachable) throw new ApiError(503, 'controller unreachable')
  }

  async getStatus(): Promise<Status> {
    await sleep(LATENCY_MS)
    const base = {
      controller: { model: 'ESP-Me', firmware: '2.9', serial: '4769753604227727360' },
      rain_sensor_active: this.rainSensorActive,
      rain_delay_days: this.rainDelayDays,
    }
    if (this._unreachable && this.cached) {
      return {
        ...base,
        zones: this.cached.zones,
        reachable: false,
        cached_at: this.cached.cachedAt,
      }
    }
    return { ...base, zones: this.zones(), reachable: true }
  }

  async startZone(id: number, minutes: number): Promise<ActiveZonesResponse> {
    await sleep(LATENCY_MS)
    this.failIfUnreachable()
    if (!Number.isInteger(id) || id < 1 || id > ZONE_COUNT)
      throw new ApiError(404, 'unknown zone')
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)
      throw new ApiError(422, 'minutes must be between 1 and 240')
    this.running = { id, endsAt: Date.now() + minutes * 60 * 1000 }
    return { active_zones: [id] }
  }

  async stopAll(): Promise<ActiveZonesResponse> {
    await sleep(LATENCY_MS)
    this.failIfUnreachable()
    this.running = null
    return { active_zones: [] }
  }

  async renameZone(id: number, name: string): Promise<Zone> {
    await sleep(LATENCY_MS)
    if (!Number.isInteger(id) || id < 1 || id > ZONE_COUNT)
      throw new ApiError(404, 'unknown zone')
    const trimmed = name.trim()
    if (trimmed.length < 1 || trimmed.length > 40)
      throw new ApiError(422, 'name must be 1-40 characters')
    this.names.set(id, trimmed)
    const zone = this.zones().find((z) => z.id === id)!
    return zone
  }

  async getRainDelay(): Promise<RainDelayResponse> {
    await sleep(LATENCY_MS)
    this.failIfUnreachable()
    return { days: this.rainDelayDays }
  }

  async setRainDelay(days: number): Promise<RainDelayResponse> {
    await sleep(LATENCY_MS)
    this.failIfUnreachable()
    if (!Number.isInteger(days) || days < 0 || days > 14)
      throw new ApiError(422, 'days must be between 0 and 14')
    this.rainDelayDays = days
    return { days }
  }
}
