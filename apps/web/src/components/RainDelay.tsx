import { useState } from 'react'

interface Props {
  days: number
  busy: boolean
  offline: boolean
  onSet: (days: number) => Promise<boolean>
}

export function RainDelay({ days, busy, offline, onSet }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(days)

  const apply = async (value: number) => {
    if (await onSet(value)) setOpen(false)
  }

  return (
    <div className="raindelay">
      <button
        className={days > 0 ? 'chip chip-button chip-active' : 'chip chip-button'}
        disabled={offline}
        aria-expanded={open}
        onClick={() => {
          setDraft(days)
          setOpen((o) => !o)
        }}
      >
        <span className={days > 0 ? 'dot dot-delay' : 'dot'} aria-hidden="true" />
        Rain delay: {days > 0 ? `${days} day${days === 1 ? '' : 's'}` : 'off'}
      </button>

      {open && (
        <div className="delay-panel">
          <div className="stepper">
            <button
              aria-label="Fewer days"
              onClick={() => setDraft((d) => Math.max(0, d - 1))}
              disabled={draft <= 0}
            >
              &minus;
            </button>
            <span className="stepper-value">
              {draft === 0 ? 'off' : `${draft} day${draft === 1 ? '' : 's'}`}
            </span>
            <button
              aria-label="More days"
              onClick={() => setDraft((d) => Math.min(14, d + 1))}
              disabled={draft >= 14}
            >
              +
            </button>
          </div>
          <div className="delay-actions">
            <button
              className="btn primary"
              disabled={busy || draft === days}
              onClick={() => void apply(draft)}
            >
              Set
            </button>
            {days > 0 && (
              <button className="btn ghost" disabled={busy} onClick={() => void apply(0)}>
                Clear
              </button>
            )}
            <button className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
