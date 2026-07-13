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

export function RainDelayChip({ days, busy, offline, canEdit, onSet }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(days);

  const apply = async (value: number) => {
    if (await onSet(value)) setOpen(false);
  };

  const chip = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 rounded-full",
          days > 0 ? "bg-primary" : "bg-muted-foreground opacity-60",
        )}
      />
      Rain delay: {days > 0 ? `${days} day${days === 1 ? "" : "s"}` : "off"}
    </>
  );

  const chipClass = cn(
    "inline-flex min-h-10 items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm shadow-(--shadow-card)",
    days > 0 && "border-primary bg-secondary font-semibold text-secondary-foreground",
  );

  if (!canEdit) {
    return <span className={chipClass}>{chip}</span>;
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        className={cn(chipClass, "disabled:cursor-default disabled:opacity-55")}
        disabled={offline}
        aria-expanded={open}
        onClick={() => {
          setDraft(days);
          setOpen((o) => !o);
        }}
      >
        {chip}
      </button>

      {open && (
        <div className="flex flex-col gap-2.5 rounded-xl border bg-card p-3 shadow-(--shadow-card)">
          <div className="flex items-center gap-3">
            <button
              aria-label="Fewer days"
              onClick={() => setDraft((d) => Math.max(0, d - 1))}
              disabled={draft <= 0}
              className="h-12 w-12 rounded-xl border bg-background text-[22px] leading-none disabled:opacity-40"
            >
              &minus;
            </button>
            <span className="min-w-[72px] text-center text-base font-semibold tabular-nums">
              {draft === 0 ? "off" : `${draft} day${draft === 1 ? "" : "s"}`}
            </span>
            <button
              aria-label="More days"
              onClick={() => setDraft((d) => Math.min(14, d + 1))}
              disabled={draft >= 14}
              className="h-12 w-12 rounded-xl border bg-background text-[22px] leading-none disabled:opacity-40"
            >
              +
            </button>
          </div>
          <div className="flex gap-2">
            <Button
              disabled={busy || draft === days}
              onClick={() => void apply(draft)}
              className="min-h-11 rounded-xl font-semibold"
            >
              Set
            </Button>
            {days > 0 && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void apply(0)}
                className="min-h-11 rounded-xl text-muted-foreground"
              >
                Clear
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-xl text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
