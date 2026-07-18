"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// next-themes wired to the Modernist token layer: dark applies via the `.dark`
// class (globals.css), System resolves to the OS preference. Exposed to the UI
// by the Theme segmented control in the More menu / preferences.
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
