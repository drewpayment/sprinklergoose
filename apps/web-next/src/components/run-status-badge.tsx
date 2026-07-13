import { Badge } from "@/components/ui/badge";
import type { RunStatus, StepOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

// Distinct, theme-aware badge per run status (M2.S5). Colors picked to stay
// calm in both light and dark, matching the M1 look.
const RUN_STYLES: Record<RunStatus, { label: string; className: string }> = {
  running: {
    label: "Running",
    className: "bg-secondary text-secondary-foreground",
  },
  completed: {
    label: "Completed",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  partial: {
    label: "Partial",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  failed: {
    label: "Failed",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  cancelled: {
    label: "Cancelled",
    className: "border-border bg-transparent text-muted-foreground",
  },
  skipped_rain_delay: {
    label: "Rain delay",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
  missed: {
    label: "Missed",
    className: "bg-warn-bg text-warn-text border-warn-border",
  },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const style = RUN_STYLES[status] ?? {
    label: status,
    className: "border-border bg-transparent text-muted-foreground",
  };
  return (
    <Badge className={cn("border border-transparent", style.className)}>
      {status === "running" && (
        <span
          aria-hidden="true"
          className="pulse-dot h-1.5 w-1.5 rounded-full bg-current"
        />
      )}
      {style.label}
    </Badge>
  );
}

const OUTCOME_STYLES: Record<StepOutcome, { label: string; className: string }> =
  {
    completed: {
      label: "Completed",
      className:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    },
    cancelled: {
      label: "Cancelled",
      className: "border-border bg-transparent text-muted-foreground",
    },
    failed: {
      label: "Failed",
      className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    },
    skipped_disabled: {
      label: "Skipped (disabled)",
      className: "bg-warn-bg text-warn-text border-warn-border",
    },
  };

export function StepOutcomeBadge({ outcome }: { outcome: StepOutcome | null }) {
  if (!outcome) {
    return (
      <Badge className="border border-border bg-transparent text-muted-foreground">
        —
      </Badge>
    );
  }
  const style = OUTCOME_STYLES[outcome];
  return (
    <Badge className={cn("border border-transparent", style.className)}>
      {style.label}
    </Badge>
  );
}
