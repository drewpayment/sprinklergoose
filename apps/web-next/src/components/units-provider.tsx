"use client";

// Client-side source of truth for the user's unit preference, seeded from
// the server session by the (app) layout. Setting it is optimistic: the UI
// flips immediately and the Better Auth user row is updated in the
// background — on failure the choice still holds for this session and the
// next load falls back to whatever the server has.

import { createContext, useCallback, useContext, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { normalizeUnits, type Units } from "@/lib/units";

const UnitsContext = createContext<{
  units: Units;
  setUnits: (u: Units) => void;
} | null>(null);

export function UnitsProvider({
  initialUnits,
  children,
}: {
  initialUnits: Units;
  children: React.ReactNode;
}) {
  const [units, setUnitsState] = useState<Units>(normalizeUnits(initialUnits));

  const setUnits = useCallback((u: Units) => {
    setUnitsState(u);
    void authClient.updateUser({ units: u });
  }, []);

  return (
    <UnitsContext.Provider value={{ units, setUnits }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error("useUnits must be used inside UnitsProvider");
  return ctx;
}
