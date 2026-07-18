"use client";

import { CalendarPlus, Pencil, Play, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeading } from "@/components/page-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import {
  formatOccurrence,
  formatRuleSummary,
  nextOccurrence,
} from "@/lib/schedule";
import { ApiError, type ProgramView } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SchedulesManager({
  initialPrograms,
  admin,
}: {
  initialPrograms: ProgramView[];
  admin: boolean;
}) {
  const [programs, setPrograms] = useState(initialPrograms);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const toggleEnabled = async (program: ProgramView, enabled: boolean) => {
    setBusyId(program.id);
    try {
      const updated = await api.setProgramEnabled(program.id, enabled);
      setPrograms((ps) => ps.map((p) => (p.id === program.id ? updated : p)));
      toast.success(`${program.name} ${enabled ? "enabled" : "disabled"}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (program: ProgramView) => {
    setBusyId(program.id);
    try {
      await api.runProgramNow(program.id);
      toast.success(`${program.name} will start shortly`, {
        description: "Watch the dashboard for the running program.",
      });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Request failed");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (program: ProgramView) => {
    setBusyId(program.id);
    try {
      await api.deleteProgram(program.id);
      setPrograms((ps) => ps.filter((p) => p.id !== program.id));
      toast.success(`${program.name} deleted`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Delete failed");
    } finally {
      setBusyId(null);
      setConfirmDeleteId(null);
    }
  };

  return (
    <div>
      <PageHeading
        title="Schedules"
        description={
          admin
            ? "Watering programs run automatically — the controller's own timers are never used."
            : "Watering programs set up by the admin. You can run one now."
        }
        action={
          admin && (
            <Button asChild className="min-h-11 px-4">
              <Link href="/schedules/new">
                <CalendarPlus data-slot="icon" />
                New
              </Link>
            </Button>
          )
        }
      />

      {programs.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card px-6 py-12 text-center text-muted-foreground shadow-(--shadow-card)">
          <p className="text-[15px] font-medium">No schedules yet</p>
          <p className="mt-1 text-sm">
            {admin
              ? "Create one to water on a schedule."
              : "The admin hasn't created any watering programs."}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {programs.map((program) => {
            const zoneIssue = program.steps.some(
              (s) => !s.zone_enabled || s.zone_name === null,
            );
            const next = program.enabled ? nextOccurrence(program) : null;
            const busy = busyId === program.id;
            return (
              <section
                key={program.id}
                className={cn(
                  "rounded-2xl border bg-card p-4 shadow-(--shadow-card)",
                  !program.enabled && "opacity-70",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-[17px] font-semibold">
                        {program.name}
                      </h3>
                      {zoneIssue && (
                        <span
                          className="inline-flex items-center text-warn-text"
                          title="A step references a disabled or missing zone — it will be skipped."
                        >
                          <TriangleAlert
                            aria-label="A step references a disabled or missing zone"
                            className="size-4"
                          />
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13.5px] text-muted-foreground">
                      {formatRuleSummary(program)}
                    </p>
                    <p className="mt-1 text-[13px]">
                      {program.enabled ? (
                        next ? (
                          <span className="font-medium text-secondary-foreground">
                            Next: {formatOccurrence(next)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            No upcoming runs in the next week
                          </span>
                        )
                      ) : (
                        <span className="text-muted-foreground">
                          Off — won&apos;t run on schedule
                        </span>
                      )}
                    </p>
                  </div>
                  {admin ? (
                    <Switch
                      checked={program.enabled}
                      disabled={busy}
                      aria-label={`${program.name} enabled`}
                      onCheckedChange={(v) => void toggleEnabled(program, v)}
                    />
                  ) : (
                    !program.enabled && (
                      <Badge variant="outline" className="text-muted-foreground">
                        Off
                      </Badge>
                    )
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {program.enabled && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void runNow(program)}
                      className="min-h-10 rounded-xl px-3.5 font-semibold"
                    >
                      <Play data-slot="icon" />
                      Run now
                    </Button>
                  )}
                  {admin && (
                    <>
                      <Button
                        asChild
                        variant="outline"
                        className="min-h-10 rounded-xl px-3.5 font-semibold"
                      >
                        <Link href={`/schedules/${program.id}`}>
                          <Pencil data-slot="icon" />
                          Edit
                        </Link>
                      </Button>
                      {confirmDeleteId === program.id ? (
                        <span className="inline-flex items-center gap-2">
                          <Button
                            variant="destructive"
                            disabled={busy}
                            onClick={() => void remove(program)}
                            className="min-h-10 rounded-xl px-3.5 font-semibold"
                          >
                            Delete “{program.name}”?
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setConfirmDeleteId(null)}
                            className="min-h-10 rounded-xl px-3"
                          >
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setConfirmDeleteId(program.id)}
                          aria-label={`Delete ${program.name}`}
                          className="min-h-10 rounded-xl px-3 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 data-slot="icon" />
                          Delete
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
