import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Modernist input: surface fill, 1px divider border, red caret, 0 radius.
        "h-9 w-full min-w-0 rounded-none border border-input bg-[var(--color-surface)] px-2.5 py-1.5 text-sm caret-[var(--color-accent)] transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-semibold file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:border-[color-mix(in_srgb,var(--color-ink)_45%,transparent)] focus-visible:border-primary",
        "aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
