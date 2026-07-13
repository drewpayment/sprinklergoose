import { ApiError } from '../types'
import type {
  ActiveZonesResponse,
  RainDelayResponse,
  SprinklerApi,
  Status,
  Zone,
} from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    })
  } catch {
    throw new ApiError(0, 'network error')
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body: unknown = await res.json()
      if (
        typeof body === 'object' &&
        body !== null &&
        typeof (body as { detail?: unknown }).detail === 'string'
      ) {
        detail = (body as { detail: string }).detail
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export class RealApi implements SprinklerApi {
  getStatus() {
    return request<Status>('/api/status')
  }

  startZone(id: number, minutes: number) {
    return request<ActiveZonesResponse>(`/api/zones/${id}/start`, {
      method: 'POST',
      body: JSON.stringify({ minutes }),
    })
  }

  stopAll() {
    return request<ActiveZonesResponse>('/api/zones/stop', { method: 'POST' })
  }

  renameZone(id: number, name: string) {
    return request<Zone>(`/api/zones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    })
  }

  getRainDelay() {
    return request<RainDelayResponse>('/api/rain-delay')
  }

  setRainDelay(days: number) {
    return request<RainDelayResponse>('/api/rain-delay', {
      method: 'PUT',
      body: JSON.stringify({ days }),
    })
  }
}
