"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSeconds } from "@/lib/format";
import type { DashboardZone } from "@/lib/types";
import { cn } from "@/lib/utils";

const PRESETS = [5, 10, 15, 30];

interface Props {
  zone: DashboardZone;
  /** Client-side ticked countdown, seconds. Null when idle or unknown. */
  remaining: number | null;
  expanded: boolean;
  busy: boolean;
  offline: boolean;
  onToggleExpand: () => void;
  onStart: (minutes: number) => void;
  onStop: () => void;
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
}: Props) {
  const [custom, setCustom] = useState("");
  const customValid = /^\d+$/.test(custom) && +custom >= 1 && +custom <= 240;

  // Disabled zones are only ever sent to admins; render greyed, no controls.
  if (!zone.enabled) {
    return (
      <section className="rounded-2xl border bg-card p-4 opacity-60 shadow-(--shadow-card)">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block text-[17px] font-semibold break-words">
              {zone.name}
            </span>
            <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
              Zone {zone.id}
            </span>
          </div>
          <Badge variant="outline" className="text-muted-foreground">
            Disabled
          </Badge>
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "rounded-2xl border bg-card p-4 shadow-(--shadow-card)",
        zone.active &&
          "border-primary bg-gradient-to-b from-secondary to-card to-85% ring-1 ring-primary",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="block text-[17px] font-semibold break-words">
            {zone.name}
          </span>
          <span className="mt-0.5 block text-[12.5px] text-muted-foreground">
            Zone {zone.id}
          </span>
        </div>
        {zone.active ? (
          <Button
            variant="destructive"
            onClick={onStop}
            disabled={busy}
            className="min-h-11 rounded-xl px-4.5 text-[15px] font-semibold"
          >
            Stop
          </Button>
        ) : (
          <Button
            variant={expanded ? "default" : "secondary"}
            onClick={onToggleExpand}
            disabled={busy || offline}
            aria-expanded={expanded}
            className="min-h-11 rounded-xl px-4.5 text-[15px] font-semibold"
          >
            Start
          </Button>
        )}
      </div>

      {zone.active && (
        <div className="mt-3.5 flex items-baseline gap-2.5">
          <span
            aria-hidden="true"
            className="pulse-dot h-2.5 w-2.5 self-center rounded-full bg-primary"
          />
          {remaining !== null ? (
            <>
              <span className="text-[40px] leading-none font-bold tracking-tight tabular-nums text-primary dark:text-secondary-foreground">
                {formatSeconds(remaining)}
              </span>
              <span className="text-sm text-muted-foreground">remaining</span>
            </>
          ) : (
            <span className="text-[26px] leading-none font-bold text-primary dark:text-secondary-foreground">
              Running
            </span>
          )}
        </div>
      )}

      {!zone.active && expanded && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {PRESETS.map((m) => (
            <button
              key={m}
              disabled={busy}
              onClick={() => onStart(m)}
              className="flex min-h-[54px] min-w-14 flex-1 flex-col items-center justify-center gap-px rounded-xl border bg-background text-lg font-bold tabular-nums disabled:opacity-50"
            >
              {m}
              <small className="text-[11px] font-medium text-muted-foreground">
                min
              </small>
            </button>
          ))}
          <form
            className="flex basis-full gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (customValid) onStart(+custom);
            }}
          >
            <Input
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="Custom (1–240 min)"
              value={custom}
              aria-label={`Custom minutes for ${zone.name}`}
              onChange={(e) =>
                setCustom(e.target.value.replace(/\D/g, "").slice(0, 3))
              }
              className="min-h-12 flex-1 rounded-xl bg-background tabular-nums"
            />
            <Button
              type="submit"
              disabled={!customValid || busy}
              className="min-h-12 rounded-xl px-4.5 text-[15px] font-semibold"
            >
              Start
            </Button>
          </form>
        </div>
      )}
    </section>
  );
}
