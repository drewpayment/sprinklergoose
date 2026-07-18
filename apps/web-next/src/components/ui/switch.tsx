"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

// Modernist toggle: square (0 radius), 44×26 track, 18×18 knob.
// ON  = red border + red fill, knob right, knob is the ground color.
// OFF = divider border, surface fill, knob left, knob is ink@40%.
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group/switch inline-flex h-[26px] w-11 shrink-0 items-center rounded-none border-2 p-0.5 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=unchecked]:border-border data-[state=unchecked]:bg-[var(--color-surface)]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-[18px] rounded-none ring-0 transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-[var(--color-bg)] data-[state=unchecked]:translate-x-0 data-[state=unchecked]:bg-[color-mix(in_srgb,var(--color-ink)_40%,transparent)]"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
