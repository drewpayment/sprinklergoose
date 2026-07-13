import { useState } from 'react'
import type { Zone } from '../types'
import { formatSeconds } from '../format'

const PRESETS = [5, 10, 15, 30]

interface Props {
  zone: Zone
  /** Client-side ticked countdown, seconds. Null when idle or unknown. */
  remaining: number | null
  expanded: boolean
  busy: boolean
  offline: boolean
  onToggleExpand: () => void
  onStart: (minutes: number) => void
  onStop: () => void
  onRename: (name: string) => void
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M12.1 1.5a1.7 1.7 0 0 1 2.4 2.4l-8.6 8.6-3.2.8.8-3.2 8.6-8.6Zm1 1.4a.7.7 0 0 0-1 0l-.7.7 1 1 .7-.7a.7.7 0 0 0 0-1Zm-1.4 2.4-1-1-6.2 6.2-.3 1.3 1.3-.3 6.2-6.2Z" />
    </svg>
  )
}

export function ZoneCard({
  zone,
  remaining,
  expanded,
  busy,
  offline,
  onToggleExpand,
  onStart,
  onStop,
  onRename,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(zone.name)
  const [custom, setCustom] = useState('')

  const customValid = /^\d+$/.test(custom) && +custom >= 1 && +custom <= 240

  const submitName = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== zone.name && trimmed.length <= 40) onRename(trimmed)
  }

  return (
    <section className={zone.active ? 'zone zone-running' : 'zone'}>
      <div className="zone-top">
        <div className="zone-title">
          {editing ? (
            <input
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              className="name-input"
              value={draft}
              maxLength={40}
              aria-label={`Rename zone ${zone.id}`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={submitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  setDraft(zone.name)
                  setEditing(false)
                }
              }}
            />
          ) : (
            <button
              className="name"
              title="Rename zone"
              onClick={() => {
                setDraft(zone.name)
                setEditing(true)
              }}
            >
              {zone.name}
              <PencilIcon />
            </button>
          )}
          <span className="zone-id">Zone {zone.id}</span>
        </div>
        {zone.active ? (
          <button className="btn stop" onClick={onStop} disabled={busy}>
            Stop
          </button>
        ) : (
          <button
            className={expanded ? 'btn start open' : 'btn start'}
            onClick={onToggleExpand}
            disabled={busy || offline}
            aria-expanded={expanded}
          >
            Start
          </button>
        )}
      </div>

      {zone.active && (
        <div className="running-row">
          <span className="pulse" aria-hidden="true" />
          {remaining !== null ? (
            <>
              <span className="countdown">{formatSeconds(remaining)}</span>
              <span className="countdown-label">remaining</span>
            </>
          ) : (
            <span className="countdown countdown-unknown">Running</span>
          )}
        </div>
      )}

      {!zone.active && expanded && (
        <div className="picker">
          {PRESETS.map((m) => (
            <button
              key={m}
              className="preset"
              disabled={busy}
              onClick={() => onStart(m)}
            >
              {m}
              <small>min</small>
            </button>
          ))}
          <form
            className="custom"
            onSubmit={(e) => {
              e.preventDefault()
              if (customValid) onStart(+custom)
            }}
          >
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Custom (1–240 min)"
              value={custom}
              aria-label={`Custom minutes for ${zone.name}`}
              onChange={(e) => setCustom(e.target.value.replace(/\D/g, '').slice(0, 3))}
            />
            <button type="submit" className="btn go" disabled={!customValid || busy}>
              Start
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
