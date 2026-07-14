"use client";

// Wayfinding control cluster (docs/M4-MAP-SPEC.md addendum — W8/W9/W10):
// Home button, location search, and locate-me, rendered as a MapContainer
// *sibling* (like the base-layer toggle) so clicks on them never reach
// Leaflet's own click handler and therefore never add edit-mode polygon
// vertices. Imperative map moves go through `mapRef` directly since this
// tree lives outside react-leaflet's context.

import type L from "leaflet";
import { Home, LocateFixed } from "lucide-react";
import type { RefObject } from "react";
import { useState } from "react";
import { toast } from "sonner";
import type { GeocodeResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SearchControl } from "./search-control";

const HOME_ZOOM = 18;
const SEARCH_ZOOM = 17;
const LOCATE_ZOOM = 16;
const FLY_OPTIONS = { duration: 0.75 };

export interface LocateFix {
  lat: number;
  lon: number;
  accuracy: number;
}

interface Props {
  mapRef: RefObject<L.Map | null>;
  homeCenter: { lat: number; lon: number } | null;
  onSearchSelect: (result: GeocodeResult) => void;
  onLocateFix: (fix: LocateFix) => void;
}

function controlButtonClass(extra?: string) {
  return cn(
    "flex h-9 w-9 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-(--shadow-card) transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-60",
    extra,
  );
}

function locateErrorMessage(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission denied — enable it in your browser settings.";
    case err.POSITION_UNAVAILABLE:
      return "Your location is unavailable right now.";
    case err.TIMEOUT:
      return "Location request timed out.";
    default:
      return "Couldn't get your location.";
  }
}

export function WayfindingControls({
  mapRef,
  homeCenter,
  onSearchSelect,
  onLocateFix,
}: Props) {
  const [locating, setLocating] = useState(false);

  const goHome = () => {
    if (!homeCenter) return;
    mapRef.current?.flyTo([homeCenter.lat, homeCenter.lon], HOME_ZOOM, FLY_OPTIONS);
  };

  const handleSearchSelect = (result: GeocodeResult) => {
    mapRef.current?.flyTo([result.lat, result.lon], SEARCH_ZOOM, FLY_OPTIONS);
    onSearchSelect(result);
  };

  const locateMe = () => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      toast.error("This browser doesn't offer location access");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        mapRef.current?.flyTo([latitude, longitude], LOCATE_ZOOM, FLY_OPTIONS);
        onLocateFix({ lat: latitude, lon: longitude, accuracy });
        setLocating(false);
      },
      (err) => {
        toast.error(locateErrorMessage(err));
        setLocating(false);
      },
      { timeout: 10_000, enableHighAccuracy: false },
    );
  };

  return (
    <div className="absolute top-14 left-3 z-[1000] flex flex-col items-start gap-2">
      <SearchControl onSelect={handleSearchSelect} />

      {homeCenter && (
        <button
          type="button"
          onClick={goHome}
          aria-label="Center on home"
          title="Home"
          className={controlButtonClass()}
        >
          <Home className="h-4 w-4" aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        onClick={locateMe}
        disabled={locating}
        aria-label="Locate me"
        title="Locate me"
        className={controlButtonClass()}
      >
        <LocateFixed
          className={cn("h-4 w-4", locating && "animate-pulse")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
