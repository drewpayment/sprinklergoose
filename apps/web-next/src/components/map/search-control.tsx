"use client";

// Location search box (docs/M4-MAP-SPEC.md wayfinding — W9): collapsible
// icon button that expands to an input. Debounces >=500ms, min 3 chars,
// cancels stale in-flight requests (both the pending debounce timer and any
// fetch already sent) so typing quickly never fires a request per
// keystroke and never resolves out of order. Client-only, rendered as a
// MapContainer sibling (never a descendant) so its clicks never reach
// Leaflet's map click handler — see leaflet-map.tsx's edit-mode vertex
// capture, which this must not trigger.

import { Loader2, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { GeocodeResult } from "@/lib/types";

const DEBOUNCE_MS = 500;
const MIN_QUERY_LEN = 3;
const MAX_RESULTS = 5;

interface Props {
  onSelect: (result: GeocodeResult) => void;
}

export function SearchControl({ onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending debounce timer / in-flight fetch on unmount.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    [],
  );

  // Debounced, cancellable search driven directly from the input's onChange
  // (not a `query`-keyed effect) — every keystroke clears the pending timer
  // and aborts any in-flight fetch before scheduling the next one, so
  // typing quickly never fires a request per keystroke and never resolves
  // out of order.
  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    setUnavailable(false);

    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      setResults([]);
      setLoading(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      api
        .geocode(trimmed, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setResults(res.slice(0, MAX_RESULTS));
          setLoading(false);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          // 502 (upstream Nominatim failure) and network errors both
          // degrade to the same inline "search unavailable" state.
          setUnavailable(true);
          setResults([]);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
  };

  const close = () => {
    setOpen(false);
    setQuery("");
    setResults([]);
    setUnavailable(false);
    setLoading(false);
    abortRef.current?.abort();
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  const select = (r: GeocodeResult) => {
    onSelect(r);
    close();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        aria-label="Search for a location"
        title="Search"
        className="flex h-9 w-9 items-center justify-center rounded-lg border bg-card text-muted-foreground shadow-(--shadow-card) transition-colors hover:text-foreground"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  return (
    <div className="w-[min(75vw,280px)] overflow-hidden rounded-lg border bg-card shadow-(--shadow-card)">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <Search
          className="h-4 w-4 flex-none text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search for a place…"
          aria-label="Search for a location"
          className="h-7 min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        />
        {loading && (
          <Loader2
            className="h-3.5 w-3.5 flex-none animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <button
          type="button"
          onClick={close}
          aria-label="Close search"
          className="flex h-6 w-6 flex-none items-center justify-center rounded text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {unavailable && (
        <p className="border-t px-3 py-2 text-[12.5px] text-muted-foreground">
          Search unavailable — try again later.
        </p>
      )}

      {!unavailable && results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto border-t">
          {results.map((r, i) => (
            <li key={`${r.lat}-${r.lon}-${i}`}>
              <button
                type="button"
                onClick={() => select(r)}
                className="block w-full truncate px-3 py-2 text-left text-[13px] hover:bg-accent"
              >
                {r.display_name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!unavailable &&
        !loading &&
        query.trim().length >= MIN_QUERY_LEN &&
        results.length === 0 && (
          <p className="border-t px-3 py-2 text-[12.5px] text-muted-foreground">
            No results.
          </p>
        )}
    </div>
  );
}
