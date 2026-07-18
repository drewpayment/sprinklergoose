"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  days: number;
  busy: boolean;
  offline: boolean;
  /** Only admins may set the rain delay; members get a read-only chip. */
  canEdit: boolean;
  onSet: (days: number) => Promise<boolean>;
}

// Modernist rain-delay control: a ruled row with a dot + status, expanding to a
// square stepper. Red only when a delay is active.
export function RainDelayChip({ days, busy, offline, canEdit, onSet }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(days);

  const apply = async (value: number) => {
    if (await onSet(value)) setOpen(false);
  };

  const label = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "size-2 flex-none rounded-full",
          days > 0 ? "bg-primary" : "bg-muted-foreground opacity-60",
        )}
      />
      Rain delay: {days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "off"}
    </>
  );

  const rowClass = cn(
    "inline-flex min-h-11 items-center gap-2 border border-border px-3.5 text-sm",
    days > 0 && "border-primary bg-secondary font-semibold text-secondary-foreground",
  );

  if (!canEdit) {
    return <span className={rowClass}>{label}</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={cn(rowClass, "disabled:cursor-default disabled:opacity-55")}
        disabled={offline}
        aria-expanded={open}
        onClick={() => {
          setDraft(days);
          setOpen((o) => !o);
        }}
      >
        {label}
      </button>

      {open && (
        <div className="flex flex-col gap-2.5 border-2 border-border p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label="Fewer days"
              onClick={() => setDraft((d) => Math.max(0, d - 1))}
              disabled={draft <= 0}
              className="size-12 border border-border bg-[var(--color-surface)] text-[22px] leading-none disabled:opacity-40"
            >
              &minus;
            </button>
            <span className="min-w-[72px] text-center text-base font-bold tabular-nums">
              {draft === 0 ? "off" : `${draft} day${draft === 1 ? "" : "s"}`}
            </span>
            <button
              type="button"
              aria-label="More days"
              onClick={() => setDraft((d) => Math.min(14, d + 1))}
              disabled={draft >= 14}
              className="size-12 border border-border bg-[var(--color-surface)] text-[22px] leading-none disabled:opacity-40"
            >
              +
            </button>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={busy || draft === days}
              onClick={() => void apply(draft)}
              className="min-h-11"
            >
              Set
            </Button>
            {days > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void apply(0)}
                className="min-h-11 text-muted-foreground"
              >
                Clear
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="min-h-11 text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
