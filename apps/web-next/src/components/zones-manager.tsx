"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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

// Modernist Zones admin (3a): a continuous ruled list. Each row is a square
// number badge (red when enabled, outlined when off), the name, a pencil that
// swaps in a rename field with Save/Cancel, and the square enable toggle.
export function ZonesManager({ initialZones }: { initialZones: ZoneRow[] }) {
  const [rows, setRows] = useState(initialZones);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const mutate = async (
    id: number,
    patch: { name?: string; enabled?: boolean },
  ) => {
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

  const startEdit = (row: ZoneRow) => {
    setEditingId(row.id);
    setDraft(row.name);
  };

  const saveName = async (row: ZoneRow) => {
    const name = draft.trim();
    if (!name || name === row.name || name.length > 40) {
      setEditingId(null);
      return;
    }
    if (await mutate(row.id, { name })) {
      toast.success(`Zone ${row.id} renamed`);
      setEditingId(null);
    }
  };

  return (
    <div>
      <div className="border-2 border-border">
        {rows.map((row) => {
          const editing = editingId === row.id;
          return (
            <div
              key={row.id}
              className={cn(
                "border-t border-border px-4 py-3.5 first:border-t-0",
                !row.enabled && "opacity-[0.62]",
              )}
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex size-6 flex-none items-center justify-center text-[12px] font-extrabold",
                    row.enabled
                      ? "bg-primary text-primary-foreground"
                      : "border border-border text-muted-foreground",
                  )}
                >
                  {row.id}
                </span>

                {editing ? (
                  <Input
                    autoFocus
                    value={draft}
                    maxLength={40}
                    aria-label={`Name for zone ${row.id}`}
                    disabled={busyId === row.id}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveName(row);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="min-h-11 flex-1 font-semibold"
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <div className="text-[15.5px] leading-tight font-extrabold">
                      {row.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Zone {row.id}
                      {!row.enabled && " · hidden from members"}
                    </div>
                  </div>
                )}

                {!editing && (
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    aria-label={`Rename zone ${row.id}`}
                    className="flex-none text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-[17px]" strokeWidth={1.8} />
                  </button>
                )}

                <Switch
                  checked={row.enabled}
                  disabled={busyId === row.id || editing}
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
              </div>

              {editing && (
                <div className="mt-2.5 flex gap-2 pl-9">
                  <Button
                    disabled={busyId === row.id || !draft.trim()}
                    onClick={() => void saveName(row)}
                    className="min-h-10"
                  >
                    Save
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busyId === row.id}
                    onClick={() => setEditingId(null)}
                    className="min-h-10"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-[13px] text-muted-foreground">
        Unwired expansion slots have no valve on this controller. Leave them
        disabled unless hardware is added — disabled zones are hidden from
        members and the executor refuses to start them.
      </p>
    </div>
  );
}
