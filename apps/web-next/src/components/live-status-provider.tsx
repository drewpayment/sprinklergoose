"use client";

// One shared live-status poll for the whole app shell. The header's online
// chip, the dashboard Split, and the map all read the same GET /api/status
// stream instead of each mounting their own 5s poller. Behavior of the
// underlying hook is unchanged (docs/M4-MAP-SPEC.md) — this only dedupes it.

import { createContext, useContext } from "react";
import { useLiveStatus, type LiveStatus } from "@/hooks/use-live-status";

const LiveStatusContext = createContext<LiveStatus | null>(null);

export function LiveStatusProvider({ children }: { children: React.ReactNode }) {
  const live = useLiveStatus();
  return (
    <LiveStatusContext.Provider value={live}>
      {children}
    </LiveStatusContext.Provider>
  );
}

export function useSharedLiveStatus(): LiveStatus {
  const ctx = useContext(LiveStatusContext);
  if (!ctx)
    throw new Error(
      "useSharedLiveStatus must be used inside a LiveStatusProvider",
    );
  return ctx;
}
