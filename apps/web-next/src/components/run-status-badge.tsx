import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { RunStatus, StepOutcome } from "@/lib/types";
import type { VariantProps } from "class-variance-authority";

type Variant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

// Modernist mono mapping: red-tint (accent) for what's live or failed,
// 1px-red outline for weather/rain-delay skips, grey (neutral) for the rest.
const RUN_STYLES: Record<RunStatus, { label: string; variant: Variant }> = {
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "secondary" },
  partial: { label: "Partial", variant: "outline" },
  failed: { label: "Failed", variant: "default" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  skipped_rain_delay: { label: "Rain delay", variant: "outline" },
  skipped_weather: { label: "Skipped — weather", variant: "outline" },
  missed: { label: "Missed", variant: "secondary" },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const style = RUN_STYLES[status] ?? { label: status, variant: "secondary" };
  return (
    <Badge variant={style.variant}>
      {status === "running" && (
        <span
          aria-hidden="true"
          className="pulse-dot size-1.5 rounded-full bg-current"
        />
      )}
      {style.label}
    </Badge>
  );
}

const OUTCOME_STYLES: Record<StepOutcome, { label: string; variant: Variant }> =
  {
    completed: { label: "Completed", variant: "secondary" },
    cancelled: { label: "Cancelled", variant: "secondary" },
    failed: { label: "Failed", variant: "default" },
    skipped_disabled: { label: "Skipped (disabled)", variant: "outline" },
  };

export function StepOutcomeBadge({ outcome }: { outcome: StepOutcome | null }) {
  if (!outcome) {
    return <Badge variant="secondary">—</Badge>;
  }
  const style = OUTCOME_STYLES[outcome];
  return <Badge variant={style.variant}>{style.label}</Badge>;
}
