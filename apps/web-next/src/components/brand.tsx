import { cn } from "@/lib/utils";

// The sprinklergoose brand mark — a goose glyph with a red square eye, from the
// Modernist handoff (design_handoff_sprinklergoose_modernist). Copy the paths
// verbatim; colors read from the theme tokens so it inverts in dark.
export function GooseMark({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      aria-hidden="true"
      className={cn("flex-none", className)}
    >
      <path
        d="M9 27 C7.4 20 8 12 12.4 6.6 C14 4.6 16.6 4.2 18 6.2 L25.2 8.6 L18 10.4 C15.6 12.8 14.6 18 14.2 27 Z"
        fill="var(--color-ink)"
      />
      <path
        d="M15.4 9.4 C16.8 10.2 17.4 11.2 17.2 12.6"
        fill="none"
        stroke="var(--color-bg)"
        strokeWidth="1.5"
      />
      <rect x="18.4" y="7" width="2.1" height="2.1" fill="var(--color-accent)" />
    </svg>
  );
}

// Goose mark + lowercase Archivo-800 wordmark.
export function Brand({
  markSize = 26,
  wordmark = true,
  className,
  wordmarkClassName,
}: {
  markSize?: number;
  wordmark?: boolean;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <GooseMark size={markSize} />
      {wordmark && (
        <span
          className={cn(
            "font-extrabold tracking-[-0.01em] lowercase",
            wordmarkClassName,
          )}
        >
          sprinklergoose
        </span>
      )}
    </span>
  );
}
