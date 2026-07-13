"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { ApiError } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ZoneRow {
  id: number;
  name: string;
  enabled: boolean;
}

export function ZonesManager({ initialZones }: { initialZones: ZoneRow[] }) {
  const [rows, setRows] = useState(initialZones);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const mutate = async (id: number, patch: { name?: string; enabled?: boolean }) => {
    setBusyId(id);
    try {
      await api.updateZone(id, patch);
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Update failed");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const submitName = async (row: ZoneRow) => {
    const draft = drafts[row.id];
    if (draft === undefined) return;
    const name = draft.trim();
    setDrafts((d) => {
      const next = { ...d };
      delete next[row.id];
      return next;
    });
    if (!name || name === row.name || name.length > 40) return;
    if (await mutate(row.id, { name })) toast.success(`Zone ${row.id} renamed`);
  };

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <section
          key={row.id}
          className={cn(
            "rounded-2xl border bg-card p-4 shadow-(--shadow-card)",
            !row.enabled && "opacity-70",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Input
                  value={drafts[row.id] ?? row.name}
                  maxLength={40}
                  aria-label={`Name for zone ${row.id}`}
                  disabled={busyId === row.id}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [row.id]: e.target.value }))
                  }
                  onBlur={() => void submitName(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      setDrafts((d) => {
                        const next = { ...d };
                        delete next[row.id];
                        return next;
                      });
                    }
                  }}
                  className="h-11 max-w-60 rounded-xl text-[15px] font-semibold"
                />
                {drafts[row.id] !== undefined &&
                  drafts[row.id].trim() !== row.name && (
                    <Button
                      size="sm"
                      disabled={busyId === row.id || !drafts[row.id].trim()}
                      onClick={() => void submitName(row)}
                      className="h-9 rounded-lg"
                    >
                      Save
                    </Button>
                  )}
              </div>
              <span className="mt-1 block text-[12.5px] text-muted-foreground">
                Zone {row.id}
                {!row.enabled && " · hidden from members"}
              </span>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <Switch
                checked={row.enabled}
                disabled={busyId === row.id}
                aria-label={`Zone ${row.id} enabled`}
                onCheckedChange={(enabled) => {
                  void mutate(row.id, { enabled }).then((ok) => {
                    if (ok) {
                      toast.success(
                        `Zone ${row.id} ${enabled ? "enabled" : "disabled"}`,
                      );
                    }
                  });
                }}
              />
              {!row.enabled && (
                <Badge variant="outline" className="text-muted-foreground">
                  Disabled
                </Badge>
              )}
            </div>
          </div>
        </section>
      ))}
      <p className="mt-1 text-[13px] text-muted-foreground">
        Zones 6–7 have no valves wired on this controller (unwired expansion
        slots). Leave them disabled unless hardware is added — disabled zones
        are hidden from members and the executor refuses to start them.
      </p>
    </div>
  );
}
