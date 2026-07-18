import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

// Modernist status pills (`.tag`): squared (0 radius), 11px, spent red sparingly.
// accent (default/destructive) = red-tint fill for live/emphasis (Running, Failed);
// neutral (secondary) = grey for Completed/Cancelled/Paused/Member; outline = 1px
// red border for weather-skip / rain-delay / "Likely skip".
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-none border border-transparent px-2.5 py-[3px] text-[11px] font-semibold tracking-[0.02em] whitespace-nowrap transition-[color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-secondary text-secondary-foreground",
        secondary:
          "bg-[var(--color-neutral-100)] text-[var(--color-neutral-800)]",
        destructive: "bg-secondary text-secondary-foreground",
        outline: "border-primary text-primary",
        ghost: "text-muted-foreground",
        link: "text-primary underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
