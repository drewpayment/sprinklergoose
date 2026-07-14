"use client";

// Map page orchestrator (docs/M4-MAP-SPEC.md): owns edit-mode/draft-geometry
// state and live-status-derived running-zone info; the actual Leaflet
// rendering is a dynamic (`ssr: false`) import since Leaflet touches
// `window`.

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getRunningZone, useLiveStatus } from "@/hooks/use-live-status";
import { api } from "@/lib/api-client";
import { ApiError, type ZoneGeometry, type ZoneMapView } from "@/lib/types";
import { ForecastPanel } from "./forecast-panel";
import type { LatLngTuple } from "./initial-view";
import type { DrawTool } from "./leaflet-map";
import { ZoneEditPanel } from "./zone-edit-panel";

const LeafletMap = dynamic(
  () => import("./leaflet-map").then((m) => m.LeafletMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center gap-3 text-muted-foreground">
        <span
          aria-hidden="true"
          className="h-[18px] w-[18px] animate-spin rounded-full border-[2.5px] border-current border-t-transparent opacity-70"
        />
        Loading map…
      </div>
    ),
  },
);

interface Props {
  admin: boolean;
  initialZones: ZoneMapView[];
  fallbackCenter: { lat: number; lon: number } | null;
}

export function MapPageClient({ admin, initialZones, fallbackCenter }: Props) {
  const [zones, setZones] = useState(initialZones);
  const [editMode, setEditMode] = useState(false);
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);
  const [tool, setTool] = useState<DrawTool>(null);
  const [draftPin, setDraftPin] = useState<LatLngTuple | null>(null);
  const [draftPolygon, setDraftPolygon] = useState<LatLngTuple[]>([]);
  const [saving, setSaving] = useState(false);

  const live = useLiveStatus();
  const running = getRunningZone(live);

  const resetDrafts = () => {
    setSelectedZoneId(null);
    setTool(null);
    setDraftPin(null);
    setDraftPolygon([]);
  };

  const toggleEditMode = () => {
    setEditMode((e) => !e);
    resetDrafts();
  };

  const selectZone = (id: number) => {
    setSelectedZoneId(id);
    setTool(null);
    const zone = zones.find((z) => z.id === id);
    if (zone?.geometry?.type === "Point") {
      const [lon, lat] = zone.geometry.coordinates;
      setDraftPin([lat, lon]);
      setDraftPolygon([]);
    } else if (zone?.geometry?.type === "Polygon") {
      setDraftPolygon(
        zone.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]),
      );
      setDraftPin(null);
    } else {
      setDraftPin(null);
      setDraftPolygon([]);
    }
  };

  const armPin = () => {
    setTool("pin");
    setDraftPolygon([]);
  };
  const armPolygon = () => {
    setTool("polygon");
    setDraftPolygon([]);
    setDraftPin(null);
  };

  const handleMapClick = useCallback(
    (lat: number, lng: number) => {
      if (tool === "pin") {
        setDraftPin([lat, lng]);
      } else if (tool === "polygon") {
        setDraftPolygon((pts) =>
          pts.length >= 100 ? pts : [...pts, [lat, lng]],
        );
      }
    },
    [tool],
  );

  const undoLastPoint = () => setDraftPolygon((pts) => pts.slice(0, -1));
  const finishPolygon = () => setTool(null);
  const cancelDraft = () => {
    if (selectedZoneId !== null) selectZone(selectedZoneId);
    setTool(null);
  };

  const save = async () => {
    if (selectedZoneId === null) return;
    const geometry: ZoneGeometry | null = draftPin
      ? { type: "Point", coordinates: [draftPin[1], draftPin[0]] }
      : draftPolygon.length >= 3
        ? {
            type: "Polygon",
            coordinates: [draftPolygon.map(([lat, lon]) => [lon, lat])],
          }
        : null;
    if (!geometry) {
      toast.error("Place a pin or draw a polygon with at least 3 points first.");
      return;
    }
    setSaving(true);
    try {
      await api.updateZone(selectedZoneId, { geometry });
      setZones((zs) =>
        zs.map((z) => (z.id === selectedZoneId ? { ...z, geometry } : z)),
      );
      setTool(null);
      toast.success("Zone placement saved");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const clearGeometry = async () => {
    if (selectedZoneId === null) return;
    setSaving(true);
    try {
      await api.updateZone(selectedZoneId, { geometry: null });
      setZones((zs) =>
        zs.map((z) => (z.id === selectedZoneId ? { ...z, geometry: null } : z)),
      );
      setDraftPin(null);
      setDraftPolygon([]);
      setTool(null);
      toast.success("Zone placement cleared");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Clear failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start">
      <div className="min-w-0 flex-1">
        {admin && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button
              variant={editMode ? "default" : "outline"}
              size="sm"
              onClick={toggleEditMode}
              className="rounded-lg"
            >
              {editMode ? "Done editing" : "Edit mode"}
            </Button>
            {editMode && (
              <span className="text-[12.5px] text-muted-foreground">
                Select a zone below, then place a pin or draw its boundary.
              </span>
            )}
          </div>
        )}

        <div className="h-[62vh] min-h-[380px] overflow-hidden rounded-2xl border md:h-[68vh]">
          <LeafletMap
            zones={zones}
            admin={admin}
            fallbackCenter={fallbackCenter}
            runningZoneId={running?.zoneId ?? null}
            runningRemainingSeconds={running?.remainingSeconds ?? null}
            editMode={editMode}
            tool={tool}
            selectedZoneId={selectedZoneId}
            draftPin={draftPin}
            draftPolygon={draftPolygon}
            onMapClick={handleMapClick}
          />
        </div>

        {admin && editMode && (
          <ZoneEditPanel
            zones={zones}
            selectedZoneId={selectedZoneId}
            onSelectZone={selectZone}
            tool={tool}
            onArmPin={armPin}
            onArmPolygon={armPolygon}
            draftPin={draftPin}
            draftPolygon={draftPolygon}
            onUndo={undoLastPoint}
            onFinishPolygon={finishPolygon}
            onCancelDraft={cancelDraft}
            onSave={() => void save()}
            onClear={() => void clearGeometry()}
            saving={saving}
          />
        )}
      </div>

      <div className="w-full md:w-[380px] md:flex-none">
        <ForecastPanel />
      </div>
    </div>
  );
}
