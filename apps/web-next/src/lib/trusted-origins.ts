/**
 * Better Auth rejects any request whose Origin header is not in its trusted
 * list (only BETTER_AUTH_URL by default) — so hitting the app via
 * http://127.0.0.1:3000 while BETTER_AUTH_URL=http://localhost:3000 got a
 * 403 INVALID_ORIGIN before credentials were even checked.
 *
 * TRUSTED_ORIGINS is a comma-separated list of scheme://host[:port] origins
 * users actually reach the app on. In production it must include the real
 * public origin (e.g. the ingress hostname).
 */

export const DEFAULT_TRUSTED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

/**
 * Parse a comma-separated origins string (the TRUSTED_ORIGINS env var).
 * Entries are trimmed; empty entries are dropped. Returns the defaults when
 * the variable is unset, empty, or contains only separators/whitespace.
 */
export function parseTrustedOrigins(
  raw: string | undefined,
  defaults: readonly string[] = DEFAULT_TRUSTED_ORIGINS,
): string[] {
  const origins = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : [...defaults];
}
