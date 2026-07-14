"use client";

// Admin-only edit mode controls (docs/M4-MAP-SPEC.md): pick a zone, then
// either place a pin (single click) or draw a polygon (click vertices,
// undo-last-point, finish at >=3 points), then Save (PATCH) or Clear.
// Hand-rolled — no leaflet-draw or other plugin.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ZoneMapView } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { DrawTool } from "./leaflet-map";
import type { LatLngTuple } from "./initial-view";
import { zoneColor } from "./zone-colors";

interface Props {
  zones: ZoneMapView[];
  selectedZoneId: number | null;
  onSelectZone: (id: number) => void;
  tool: DrawTool;
  onArmPin: () => void;
  onArmPolygon: () => void;
  draftPin: LatLngTuple | null;
  draftPolygon: LatLngTuple[];
  onUndo: () => void;
  onFinishPolygon: () => void;
  onCancelDraft: () => void;
  onSave: () => void;
  onClear: () => void;
  saving: boolean;
}

function geometrySummary(zone: ZoneMapView): string {
  if (!zone.geometry) return "Not placed";
  if (zone.geometry.type === "Point") return "Placed · pin";
  return `Placed · polygon (${zone.geometry.coordinates[0].length} vertices)`;
}

export function ZoneEditPanel({
  zones,
  selectedZoneId,
  onSelectZone,
  tool,
  onArmPin,
  onArmPolygon,
  draftPin,
  draftPolygon,
  onUndo,
  onFinishPolygon,
  onCancelDraft,
  onSave,
  onClear,
  saving,
}: Props) {
  const selected = zones.find((z) => z.id === selectedZoneId) ?? null;
  const hasDraft = draftPin !== null || draftPolygon.length >= 3;
  const canClear = selected !== null && (selected.geometry !== null || hasDraft);
  const canSave = selected !== null && hasDraft;

  return (
    <section className="mt-3 rounded-2xl border bg-card p-4 shadow-(--shadow-card) lg:mt-0 lg:p-3">
      <h3 className="mb-2 text-[13.5px] font-semibold text-muted-foreground">
        Place zones
      </h3>

      {/* Long zone lists scroll internally on desktop, where this panel is
          pinned to the top of a viewport-height-constrained sidebar; below
          `lg` (unchanged stacked layout) it just grows with the page. */}
      <div className="flex flex-col gap-1.5 lg:max-h-[260px] lg:overflow-y-auto lg:pr-1">
        {zones.map((zone) => (
          <button
            key={zone.id}
            type="button"
            onClick={() => onSelectZone(zone.id)}
            className={cn(
              "flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
              selectedZoneId === zone.id
                ? "border-primary bg-secondary"
                : "border-border bg-background hover:bg-accent",
            )}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 flex-none rounded-full"
                style={{ background: zoneColor(zone.id) }}
              />
              <span className="min-w-0 truncate text-[14.5px] font-medium">
                {zone.name}
              </span>
              {!zone.enabled && (
                <Badge variant="outline" className="shrink-0 text-muted-foreground">
                  Disabled
                </Badge>
              )}
            </div>
            <span className="shrink-0 text-[12px] text-muted-foreground">
              {geometrySummary(zone)}
            </span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-3 flex flex-col gap-3 border-t pt-3">
          <p className="text-[13px] text-muted-foreground">
            Editing <strong className="text-foreground">{selected.name}</strong>
          </p>

          {tool === null && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={onArmPin}
                className="rounded-lg"
              >
                Place pin
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={saving}
                onClick={onArmPolygon}
                className="rounded-lg"
              >
                Draw polygon
              </Button>
            </div>
          )}

          {tool === "polygon" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-muted-foreground">
                {draftPolygon.length} point{draftPolygon.length === 1 ? "" : "s"}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={draftPolygon.length === 0}
                onClick={onUndo}
                className="rounded-lg"
              >
                Undo last point
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={draftPolygon.length < 3}
                onClick={onFinishPolygon}
                className="rounded-lg"
              >
                Finish shape
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancelDraft}
                className="rounded-lg text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          )}

          {tool === "pin" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-muted-foreground">
                {draftPin ? "Click the map to move the pin" : "Click the map to place the pin"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancelDraft}
                className="rounded-lg text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!canSave || saving}
              onClick={onSave}
              className="rounded-lg"
            >
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canClear || saving}
              onClick={onClear}
              className="rounded-lg text-destructive"
            >
              Clear
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
