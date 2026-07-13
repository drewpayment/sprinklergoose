import { useCallback, useEffect, useRef, useState } from 'react'
import { api, mockControls } from './api'
import { ApiError } from './types'
import type { Status, Zone } from './types'
import { ZoneCard } from './components/ZoneCard'
import { RainDelay } from './components/RainDelay'
import { formatClock } from './format'

const POLL_MS = 5000
const TOAST_MS = 4000

export default function App() {
  const [status, setStatus] = useState<Status | null>(null)
  const [fetchedAt, setFetchedAt] = useState(0)
  const [fetchFailed, setFetchFailed] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [expandedZone, setExpandedZone] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const toastTimer = useRef<number | undefined>(undefined)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const s = await api.getStatus()
      setStatus(s)
      setFetchedAt(Date.now())
      setFetchFailed(false)
    } catch {
      setFetchFailed(true)
    }
  }, [])

  // Poll status every 5s; pause while the tab is hidden, refetch on return.
  useEffect(() => {
    let timer: number | undefined
    const start = () => {
      void refresh()
      timer = window.setInterval(() => void refresh(), POLL_MS)
    }
    const stop = () => {
      window.clearInterval(timer)
      timer = undefined
    }
    const onVisibility = () => {
      stop()
      if (!document.hidden) start()
    }
    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  const offline = fetchFailed || (status !== null && !status.reachable)
  const anyRunning = status?.zones.some((z) => z.active) ?? false
  const hasCountdown =
    !offline && (status?.zones.some((z) => z.active && z.remaining_seconds !== null) ?? false)

  // Tick the countdown down client-side between polls.
  useEffect(() => {
    if (!hasCountdown) return
    const t = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => window.clearInterval(t)
  }, [hasCountdown])

  const remainingFor = (zone: Zone): number | null => {
    if (!zone.active || zone.remaining_seconds === null) return null
    if (offline) return zone.remaining_seconds // frozen cached value
    const elapsed = Math.round((Date.now() - fetchedAt) / 1000)
    return Math.max(0, zone.remaining_seconds - elapsed)
  }

  /** Run a command, then refetch status promptly to verify. Returns success. */
  const runCommand = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true)
      try {
        await fn()
        await refresh()
        return true
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          showToast('Controller unreachable — command not sent')
        } else if (e instanceof ApiError && e.status !== 0) {
          showToast(e.detail)
        } else {
          showToast('Network error — command not sent')
        }
        void refresh()
        return false
      } finally {
        setBusy(false)
      }
    },
    [refresh, showToast],
  )

  const startZone = async (id: number, minutes: number) => {
    if (await runCommand(() => api.startZone(id, minutes))) setExpandedZone(null)
  }
  const stopAll = () => void runCommand(() => api.stopAll())
  const renameZone = (id: number, name: string) =>
    void runCommand(() => api.renameZone(id, name))
  const setRainDelay = (days: number) => runCommand(() => api.setRainDelay(days))

  return (
    <div className="app">
      <header className="header">
        <h1>Sprinkler</h1>
        {status && (
          <p className="sub">
            {status.controller.model} · firmware {status.controller.firmware}
          </p>
        )}
      </header>

      {offline && (
        <div className="banner" role="alert">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>Controller offline</strong>
            <span className="banner-sub">
              Retrying automatically
              {status?.cached_at
                ? ` — showing state from ${formatClock(status.cached_at)}`
                : ''}
            </span>
          </div>
        </div>
      )}

      {status ? (
        <>
          <div className="chips">
            <span className="chip">
              <span
                className={status.rain_sensor_active ? 'dot dot-wet' : 'dot'}
                aria-hidden="true"
              />
              Rain sensor: {status.rain_sensor_active ? 'wet' : 'dry'}
            </span>
            <RainDelay
              days={status.rain_delay_days}
              busy={busy}
              offline={offline}
              onSet={setRainDelay}
            />
          </div>

          <main className="zones">
            {status.zones.map((zone) => (
              <ZoneCard
                key={zone.id}
                zone={zone}
                remaining={remainingFor(zone)}
                expanded={expandedZone === zone.id}
                busy={busy}
                offline={offline}
                onToggleExpand={() =>
                  setExpandedZone((cur) => (cur === zone.id ? null : zone.id))
                }
                onStart={(minutes) => void startZone(zone.id, minutes)}
                onStop={stopAll}
                onRename={(name) => renameZone(zone.id, name)}
              />
            ))}
          </main>
        </>
      ) : (
        !offline && (
          <div className="loading">
            <span className="spinner" aria-hidden="true" />
            Connecting to controller…
          </div>
        )
      )}

      {anyRunning && !offline && (
        <button className="stop-all" onClick={stopAll} disabled={busy}>
          Stop all watering
        </button>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {mockControls && <MockBadge />}
    </div>
  )
}

/** Dev-only badge shown in mock mode; taps toggle the fake offline state. */
function MockBadge() {
  const [unreachable, setUnreachable] = useState(mockControls!.unreachable)
  return (
    <button
      className="mock-badge"
      title="Toggle mock controller reachability"
      onClick={() => setUnreachable(mockControls!.toggle())}
    >
      MOCK · {unreachable ? 'unreachable' : 'reachable'}
    </button>
  )
}
