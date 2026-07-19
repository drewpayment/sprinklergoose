"use client";

// The actual Leaflet map (docs/M4-MAP-SPEC.md). Client-only — Leaflet
// touches `window` — loaded from map-page-client.tsx via `next/dynamic`
// with `ssr: false`. Never imported anywhere else.

import "leaflet/dist/leaflet.css";
import type { Map as LeafletMapInstance } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMapEvents,
} from "react-leaflet";
import { formatSeconds } from "@/lib/format";
import type { GeocodeResult, ZoneMapView } from "@/lib/types";
import { computeInitialView, type LatLngTuple } from "./initial-view";
import {
  createHomeIcon,
  createLocateDotIcon,
  createSearchResultIcon,
  createVertexIcon,
  createZoneIcon,
} from "./zone-icon";
import { zoneColor } from "./zone-colors";
import { WayfindingControls, type LocateFix } from "./wayfinding-controls";

const ESRI_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_ATTRIBUTION = "Tiles &copy; Esri";
const OSM_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_ATTRIBUTION = "&copy; OpenStreetMap contributors";

export type DrawTool = "pin" | "polygon" | "home" | null;

// Esri World Imagery serves tiles to ~19; let Leaflet upscale beyond that so
// suburban lots are actually traceable in edit mode.
const MAX_NATIVE_ZOOM = 19;
const MAX_ZOOM = 22;

export interface LeafletMapProps {
  zones: ZoneMapView[];
  admin: boolean;
  fallbackCenter: { lat: number; lon: number } | null;
  runningZoneId: number | null;
  runningRemainingSeconds: number | null;
  editMode: boolean;
  tool: DrawTool;
  selectedZoneId: number | null;
  draftPin: LatLngTuple | null;
  draftPolygon: LatLngTuple[];
  onMapClick: (lat: number, lng: number) => void;
  /** Admin edit mode: called when the home marker is dragged to a new spot. */
  onHomeMoved?: (lat: number, lon: number) => void;
}

function zoneRingLatLngs(zone: ZoneMapView): LatLngTuple[] | null {
  if (!zone.geometry || zone.geometry.type !== "Polygon") return null;
  return zone.geometry.coordinates[0].map(
    ([lon, lat]) => [lat, lon] as LatLngTuple,
  );
}

function zonePointLatLng(zone: ZoneMapView): LatLngTuple | null {
  if (!zone.geometry || zone.geometry.type !== "Point") return null;
  const [lon, lat] = zone.geometry.coordinates;
  return [lat, lon];
}

function ZoneMarker({
  zone,
  muted,
  pulsing,
  label,
}: {
  zone: ZoneMapView;
  muted: boolean;
  pulsing: boolean;
  label: string;
}) {
  const position = zonePointLatLng(zone);
  const color = zoneColor(zone.id);
  const icon = useMemo(
    () => createZoneIcon(color, { muted, pulsing }),
    [color, muted, pulsing],
  );
  if (!position) return null;
  return (
    <Marker position={position} icon={icon}>
      <Tooltip
        permanent
        direction="top"
        className={pulsing ? "zone-running-tooltip" : "zone-name-tooltip"}
      >
        {label}
      </Tooltip>
    </Marker>
  );
}

function ZonePolygonLayer({
  zone,
  muted,
  pulsing,
  label,
}: {
  zone: ZoneMapView;
  muted: boolean;
  pulsing: boolean;
  label: string;
}) {
  const ring = zoneRingLatLngs(zone);
  const color = zoneColor(zone.id);
  if (!ring) return null;
  return (
    // Leaflet only applies pathOptions.className at layer creation (not on
    // setStyle updates) — remount on pulse toggle via `key` so the CSS
    // animation class actually (dis)appears when a run starts/ends.
    <Polygon
      key={`${zone.id}-${pulsing}`}
      positions={ring}
      pathOptions={{
        color,
        weight: muted ? 1.5 : 2,
        fillColor: color,
        fillOpacity: muted ? 0.15 : 0.35,
        dashArray: muted ? "6 4" : undefined,
        className: pulsing ? "zone-polygon-pulse" : undefined,
      }}
    >
      <Tooltip
        direction="top"
        className={pulsing ? "zone-running-tooltip" : "zone-name-tooltip"}
        permanent
      >
        {label}
      </Tooltip>
    </Polygon>
  );
}

function MapClickCapture({
  active,
  onClick,
}: {
  active: boolean;
  onClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (!active) return;
      onClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function BaseLayerToggle({
  layer,
  onChange,
}: {
  layer: "satellite" | "street";
  onChange: (l: "satellite" | "street") => void;
}) {
  return (
    <div className="absolute top-3 right-3 z-[1000] flex overflow-hidden rounded-lg border bg-card shadow-(--shadow-card)">
      {(["satellite", "street"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={layer === l}
          className={`min-h-9 px-3 text-[12.5px] font-semibold capitalize transition-colors ${
            layer === l
              ? "bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:text-foreground"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function LeafletMap({
  zones,
  admin,
  fallbackCenter,
  runningZoneId,
  runningRemainingSeconds,
  editMode,
  tool,
  selectedZoneId,
  draftPin,
  draftPolygon,
  onMapClick,
  onHomeMoved,
}: LeafletMapProps) {
  const [baseLayer, setBaseLayer] = useState<"satellite" | "street">(
    "satellite",
  );
  // Wayfinding (docs/M4-MAP-SPEC.md addendum): search result + locate-me
  // fix are ephemeral UI state only — never persisted, never written to the
  // DB. mapRef lets the sibling WayfindingControls tree (outside
  // react-leaflet's context) imperatively pan/zoom the map.
  const mapRef = useRef<LeafletMapInstance | null>(null);
  // Mirrors mapRef into state so the resize-observer effect below can pick
  // up the instance once react-leaflet actually creates it (refs alone
  // don't retrigger effects).
  const [mapInstance, setMapInstance] = useState<LeafletMapInstance | null>(
    null,
  );
  const [searchMarker, setSearchMarker] = useState<GeocodeResult | null>(
    null,
  );
  const [locateFix, setLocateFix] = useState<LocateFix | null>(null);

  // The desktop layout resizes the map's container via CSS (viewport-height
  // clamp, grid columns) rather than the window itself, and Leaflet only
  // auto-recalculates on `window` resize — so watch the container directly
  // and tell Leaflet to recompute (docs/M4-MAP-SPEC.md: map.invalidateSize()
  // any time the container's own size changes, not just the window's).
  useEffect(() => {
    if (!mapInstance) return;
    const container = mapInstance.getContainer();
    const ro = new ResizeObserver(() => {
      mapInstance.invalidateSize();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [mapInstance]);

  const view = useMemo(
    () => computeInitialView(zones, fallbackCenter),
    // Only the very first computation matters — MapContainer only honors
    // center/zoom/bounds on initial mount (see react-leaflet MapContainer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const hint =
    view.kind === "center" && view.hint
      ? admin
        ? "Set your location in Weather settings, then place zones in edit mode."
        : "Ask an admin to place zones on the map."
      : null;

  const selectedColor =
    selectedZoneId !== null ? zoneColor(selectedZoneId) : "#0e7490";

  return (
    <div className="relative h-full w-full">
      <MapContainer
        ref={(m) => {
          mapRef.current = m;
          if (m) setMapInstance(m);
        }}
        {...(view.kind === "bounds"
          ? { bounds: view.bounds }
          : { center: view.center, zoom: view.zoom })}
        className="h-full w-full"
        scrollWheelZoom
        maxZoom={MAX_ZOOM}
      >
        {baseLayer === "satellite" ? (
          <TileLayer
            url={ESRI_URL}
            attribution={ESRI_ATTRIBUTION}
            maxZoom={MAX_ZOOM}
            maxNativeZoom={MAX_NATIVE_ZOOM}
          />
        ) : (
          <TileLayer
            url={OSM_URL}
            attribution={OSM_ATTRIBUTION}
            maxZoom={MAX_ZOOM}
            maxNativeZoom={MAX_NATIVE_ZOOM}
          />
        )}

        {/* Home anchor (W8) — the weather-settings location, rendered with
            a house glyph so it's never confused with a zone pin. In admin
            edit mode it's draggable so a misplaced home can be corrected. */}
        {fallbackCenter && (
          <Marker
            position={[fallbackCenter.lat, fallbackCenter.lon]}
            icon={createHomeIcon()}
            draggable={editMode && onHomeMoved !== undefined}
            eventHandlers={
              onHomeMoved
                ? {
                    dragend: (e) => {
                      const p = e.target.getLatLng();
                      onHomeMoved(p.lat, p.lng);
                    },
                  }
                : undefined
            }
          >
            <Tooltip direction="top" className="zone-name-tooltip">
              {editMode && onHomeMoved ? "Home — drag to move" : "Home"}
            </Tooltip>
          </Marker>
        )}

        {/* Search result (W9) — temporary, dismissable via the popup's
            close button or by clicking elsewhere; never persisted. */}
        {searchMarker && (
          <Marker
            position={[searchMarker.lat, searchMarker.lon]}
            icon={createSearchResultIcon()}
            eventHandlers={{
              add: (e) => e.target.openPopup(),
              popupclose: () => setSearchMarker(null),
            }}
          >
            <Popup>{searchMarker.display_name}</Popup>
          </Marker>
        )}

        {/* Locate-me fix (W10) — blue dot + accuracy circle, temporary,
            never persisted. */}
        {locateFix && (
          <>
            <Circle
              center={[locateFix.lat, locateFix.lon]}
              radius={locateFix.accuracy}
              pathOptions={{
                color: "#2563eb",
                weight: 1,
                fillColor: "#2563eb",
                fillOpacity: 0.12,
              }}
            />
            <Marker
              position={[locateFix.lat, locateFix.lon]}
              icon={createLocateDotIcon()}
              interactive={false}
            />
          </>
        )}

        {zones.map((zone) => {
          const pulsing = zone.id === runningZoneId;
          const muted = admin && !zone.enabled;
          const label =
            pulsing && runningRemainingSeconds !== null
              ? `${zone.name} · ${formatSeconds(runningRemainingSeconds)}`
              : zone.name;
          if (zone.geometry?.type === "Point") {
            return (
              <ZoneMarker
                key={zone.id}
                zone={zone}
                muted={muted}
                pulsing={pulsing}
                label={label}
              />
            );
          }
          if (zone.geometry?.type === "Polygon") {
            return (
              <ZonePolygonLayer
                key={zone.id}
                zone={zone}
                muted={muted}
                pulsing={pulsing}
                label={label}
              />
            );
          }
          return null;
        })}

        {/* Edit-mode draft preview (admin only). */}
        {editMode && draftPin && (
          <Marker
            position={draftPin}
            icon={createZoneIcon(selectedColor, {})}
          />
        )}
        {editMode && draftPolygon.length > 0 && (
          <>
            <Polyline
              positions={draftPolygon}
              pathOptions={{ color: selectedColor, weight: 3, dashArray: "5 5" }}
            />
            {draftPolygon.length >= 3 && (
              <Polygon
                positions={draftPolygon}
                pathOptions={{
                  color: selectedColor,
                  weight: 2,
                  fillColor: selectedColor,
                  fillOpacity: 0.2,
                  dashArray: "5 5",
                }}
              />
            )}
            {draftPolygon.map((pt, i) => (
              <Marker
                key={`vertex-${i}`}
                position={pt}
                icon={createVertexIcon()}
              />
            ))}
          </>
        )}

        <MapClickCapture
          active={editMode && tool !== null}
          onClick={onMapClick}
        />
      </MapContainer>

      <BaseLayerToggle layer={baseLayer} onChange={setBaseLayer} />

      <WayfindingControls
        mapRef={mapRef}
        homeCenter={fallbackCenter}
        onSearchSelect={setSearchMarker}
        onLocateFix={setLocateFix}
      />

      {editMode && tool !== null && (
        <div className="pointer-events-none absolute top-3 left-3 z-[1000] rounded-lg border bg-card px-3 py-1.5 text-[12.5px] font-medium shadow-(--shadow-card)">
          {tool === "pin"
            ? "Click the map to place the pin"
            : tool === "home"
              ? "Click the map to set your home location"
              : "Click to add points · need 3+ to finish"}
        </div>
      )}

      {hint && (
        <div className="pointer-events-none absolute inset-0 z-[900] flex items-center justify-center p-6">
          <p className="max-w-xs rounded-xl border bg-card px-4 py-3 text-center text-[13.5px] font-medium text-muted-foreground shadow-(--shadow-card)">
            {hint}
          </p>
        </div>
      )}
    </div>
  );
}
