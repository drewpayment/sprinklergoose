// Stable per-zone-id color palette (docs/M4-MAP-SPEC.md: "polygons filled
// with a per-zone color (stable palette by zone id)"). Zone ids are
// controller stations (1..7, see src/db/schema.ts) but the palette repeats
// for any id via modulo so it never runs out.

const PALETTE = [
  "#2563eb", // blue
  "#dc2626", // red
  "#16a34a", // green
  "#d97706", // amber
  "#7c3aed", // violet
  "#0891b2", // cyan
  "#db2777", // pink
  "#65a30d", // lime
];

export function zoneColor(id: number): string {
  const idx = ((id - 1) % PALETTE.length) + PALETTE.length;
  return PALETTE[idx % PALETTE.length];
}
