"use client";

// M3.Q — Quick Run: ad-hoc multi-zone run with no program. Enabled zones as
// checkboxes in ascending zone order (= run order), one shared minutes
// input applied to every selected zone. Progress shows up in the existing
// program-run banner once /api/status reports it — no progress UI here.

import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/types";

const DEFAULT_MINUTES = "10";

interface Props {
  /** Enabled zones only, ascending id order — disabled zones are never offered. */
  zones: { id: number; name: string }[];
  disabled: boolean;
  onSubmitted: () => void;
  /** Optional custom trigger (defaults to a "Quick run ›" ghost link). */
  trigger?: React.ReactNode;
}

export function QuickRunDialog({ zones, disabled, onSubmitted, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const minutesId = useId();

  const reset = () => {
    setSelected(new Set());
    setMinutes(DEFAULT_MINUTES);
    setError(null);
  };

  const minutesNum = Number(minutes);
  const minutesValid =
    /^\d+$/.test(minutes) && minutesNum >= 1 && minutesNum <= 240;

  const allSelected = zones.length > 0 && selected.size === zones.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleZone = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelected(checked ? new Set(zones.map((z) => z.id)) : new Set());
  };

  const submit = async () => {
    if (selected.size === 0) {
      setError("Select at least one zone.");
      return;
    }
    if (!minutesValid) {
      setError("Minutes must be a whole number between 1 and 240.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const steps = zones
        .filter((z) => selected.has(z.id))
        .map((z) => ({ zone_id: z.id, minutes: minutesNum }));
      await api.quickRun(steps);
      toast.success("Quick run started");
      setOpen(false);
      reset();
      onSubmitted();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Quick run failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            disabled={disabled || zones.length === 0}
            className="text-xs font-extrabold text-primary disabled:opacity-50"
          >
            Quick run ›
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Quick run</DialogTitle>
          <DialogDescription>
            Water several zones back-to-back without creating a program.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between">
          <Label className="cursor-pointer">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={(c) => toggleAll(c === true)}
              aria-label="Select all zones"
            />
            Select all
          </Label>
          <span className="text-xs text-muted-foreground">
            {selected.size} of {zones.length} selected
          </span>
        </div>

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto border-2 border-border p-2">
          {zones.map((z) => (
            <Label
              key={z.id}
              className="flex min-h-10 cursor-pointer items-center gap-2.5 px-2 py-1.5 hover:bg-accent"
            >
              <Checkbox
                checked={selected.has(z.id)}
                onCheckedChange={(c) => toggleZone(z.id, c === true)}
                aria-label={`Include ${z.name} (zone ${z.id})`}
              />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">
                {z.name}
              </span>
              <span className="text-xs text-muted-foreground">
                Zone {z.id}
              </span>
            </Label>
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={minutesId}>Minutes per zone</Label>
          <Input
            id={minutesId}
            inputMode="numeric"
            pattern="[0-9]*"
            value={minutes}
            aria-label="Minutes per zone"
            onChange={(e) =>
              setMinutes(e.target.value.replace(/\D/g, "").slice(0, 3))
            }
            className="h-11 max-w-32 tabular-nums"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? "Starting…" : "Start quick run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
