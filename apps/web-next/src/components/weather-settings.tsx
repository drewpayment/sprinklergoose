"use client";

// Admin → Weather (M3): enable toggle, location (with browser geolocation),
// and three plain-language threshold fields. Client validation mirrors the
// server (weather-validation.ts) so every M3.S1 case gets an inline message
// before a request is sent — the server still enforces everything.

import { LocateFixed } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import {
  ApiError,
  type WeatherSettingsInput,
  type WeatherSettingsView,
} from "@/lib/types";
import { WEATHER_LIMITS } from "@/lib/weather-validation";

const inputClass = "min-h-11 rounded-xl text-[15px]";

interface Errors {
  location?: string;
  rain_lookback_mm?: string;
  forecast_lookahead_mm?: string;
  freeze_temp_c?: string;
}

/** "" stays null; anything else must parse as a finite number. */
function parseOptionalNumber(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export function WeatherSettings({
  initialSettings,
}: {
  initialSettings: WeatherSettingsView;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialSettings.enabled);
  const [latitude, setLatitude] = useState(
    initialSettings.latitude === null ? "" : String(initialSettings.latitude),
  );
  const [longitude, setLongitude] = useState(
    initialSettings.longitude === null ? "" : String(initialSettings.longitude),
  );
  const [rainLookback, setRainLookback] = useState(
    String(initialSettings.rain_lookback_mm),
  );
  const [forecastLookahead, setForecastLookahead] = useState(
    String(initialSettings.forecast_lookahead_mm),
  );
  const [freezeTemp, setFreezeTemp] = useState(
    String(initialSettings.freeze_temp_c),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  const useBrowserLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("This browser doesn't offer location access");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(4));
        setLongitude(pos.coords.longitude.toFixed(4));
        setLocating(false);
      },
      () => {
        toast.error("Couldn't get your location — enter it manually");
        setLocating(false);
      },
      { timeout: 10_000 },
    );
  };

  const validate = (): WeatherSettingsInput | null => {
    const next: Errors = {};
    const lat = parseOptionalNumber(latitude);
    const lon = parseOptionalNumber(longitude);
    if (
      lat === undefined ||
      (lat !== null &&
        (lat < WEATHER_LIMITS.latitude.min || lat > WEATHER_LIMITS.latitude.max))
    ) {
      next.location = "Latitude must be a number between -90 and 90.";
    } else if (
      lon === undefined ||
      (lon !== null &&
        (lon < WEATHER_LIMITS.longitude.min ||
          lon > WEATHER_LIMITS.longitude.max))
    ) {
      next.location = "Longitude must be a number between -180 and 180.";
    } else if ((lat === null) !== (lon === null)) {
      next.location = "Enter both latitude and longitude, or neither.";
    } else if (enabled && lat === null) {
      next.location = "A location is required to enable weather skips.";
    }

    const rain = parseOptionalNumber(rainLookback);
    if (
      rain === null ||
      rain === undefined ||
      rain < WEATHER_LIMITS.mm.min ||
      rain > WEATHER_LIMITS.mm.max
    ) {
      next.rain_lookback_mm = "Enter a rainfall amount between 0 and 100 mm.";
    }
    const forecast = parseOptionalNumber(forecastLookahead);
    if (
      forecast === null ||
      forecast === undefined ||
      forecast < WEATHER_LIMITS.mm.min ||
      forecast > WEATHER_LIMITS.mm.max
    ) {
      next.forecast_lookahead_mm =
        "Enter a rainfall amount between 0 and 100 mm.";
    }
    const freeze = parseOptionalNumber(freezeTemp);
    if (
      freeze === null ||
      freeze === undefined ||
      freeze < WEATHER_LIMITS.temp.min ||
      freeze > WEATHER_LIMITS.temp.max
    ) {
      next.freeze_temp_c = "Enter a temperature between -30 and 10 °C.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      enabled,
      latitude: lat as number | null,
      longitude: lon as number | null,
      rain_lookback_mm: rain as number,
      forecast_lookahead_mm: forecast as number,
      freeze_temp_c: freeze as number,
    };
  };

  const save = async () => {
    const input = validate();
    if (!input) return;
    setSaving(true);
    try {
      await api.updateWeatherSettings(input);
      toast.success(
        input.enabled
          ? "Weather settings saved — scheduled runs now defer to the weather"
          : "Weather settings saved — weather skips are off",
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (msg?: string) =>
    msg ? (
      <p role="alert" className="mt-1.5 text-[13px] font-medium text-destructive">
        {msg}
      </p>
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Enable */}
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Skip watering based on weather</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              Scheduled runs are skipped after heavy rain, before forecast
              rain, or near freezing. Run now always waters.
            </p>
          </div>
          <Switch
            checked={enabled}
            aria-label="Skip watering based on weather"
            onCheckedChange={setEnabled}
          />
        </div>
      </section>

      {/* Location */}
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
        <p className="text-sm font-medium">Location</p>
        <p className="mt-0.5 mb-3 text-[13px] text-muted-foreground">
          Weather is checked for these coordinates. Required when skips are on.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="weather-lat" className="mb-2">
              Latitude
            </Label>
            <Input
              id="weather-lat"
              inputMode="decimal"
              placeholder="e.g. 42.3314"
              value={latitude}
              aria-invalid={errors.location ? true : undefined}
              onChange={(e) => setLatitude(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <Label htmlFor="weather-lon" className="mb-2">
              Longitude
            </Label>
            <Input
              id="weather-lon"
              inputMode="decimal"
              placeholder="e.g. -83.0458"
              value={longitude}
              aria-invalid={errors.location ? true : undefined}
              onChange={(e) => setLongitude(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        {fieldError(errors.location)}
        <Button
          variant="outline"
          disabled={locating}
          onClick={useBrowserLocation}
          className="mt-3 min-h-10 rounded-xl px-3.5 font-semibold"
        >
          <LocateFixed data-slot="icon" />
          {locating ? "Locating…" : "Use browser location"}
        </Button>
      </section>

      {/* Thresholds */}
      <section className="rounded-2xl border bg-card p-4 shadow-(--shadow-card)">
        <p className="mb-3 text-sm font-medium">When to skip</p>

        <Label htmlFor="weather-rain-lookback" className="mb-2 font-normal">
          <span className="leading-snug">
            Skip if more than <b>this many mm</b> fell in the last 24 hours
          </span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="weather-rain-lookback"
            inputMode="decimal"
            value={rainLookback}
            aria-invalid={errors.rain_lookback_mm ? true : undefined}
            onChange={(e) => setRainLookback(e.target.value)}
            className={`${inputClass} max-w-28`}
          />
          <span className="text-sm text-muted-foreground">mm (default 6)</span>
        </div>
        {fieldError(errors.rain_lookback_mm)}

        <Label
          htmlFor="weather-forecast-lookahead"
          className="mt-4 mb-2 font-normal"
        >
          <span className="leading-snug">
            Skip if more than <b>this many mm</b> are forecast for the next 6
            hours
          </span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="weather-forecast-lookahead"
            inputMode="decimal"
            value={forecastLookahead}
            aria-invalid={errors.forecast_lookahead_mm ? true : undefined}
            onChange={(e) => setForecastLookahead(e.target.value)}
            className={`${inputClass} max-w-28`}
          />
          <span className="text-sm text-muted-foreground">mm (default 4)</span>
        </div>
        {fieldError(errors.forecast_lookahead_mm)}

        <Label htmlFor="weather-freeze-temp" className="mt-4 mb-2 font-normal">
          <span className="leading-snug">
            Skip if the temperature is at or below <b>this many °C</b>
          </span>
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="weather-freeze-temp"
            inputMode="decimal"
            value={freezeTemp}
            aria-invalid={errors.freeze_temp_c ? true : undefined}
            onChange={(e) => setFreezeTemp(e.target.value)}
            className={`${inputClass} max-w-28`}
          />
          <span className="text-sm text-muted-foreground">°C (default 1)</span>
        </div>
        {fieldError(errors.freeze_temp_c)}
      </section>

      <Button
        disabled={saving}
        onClick={() => void save()}
        className="min-h-12 rounded-xl text-[16px] font-bold"
      >
        {saving ? "Saving…" : "Save weather settings"}
      </Button>
    </div>
  );
}
