import type { ConnectionConfig } from "@/types/connection";

/**
 * Stable palette used when a connection has no user-picked color. Ten hues
 * chosen to remain legible on both light and dark backgrounds.
 */
const PALETTE = [
  "#ef4444", // red-500
  "#f97316", // orange-500
  "#eab308", // yellow-500
  "#10b981", // emerald-500
  "#06b6d4", // cyan-500
  "#3b82f6", // blue-500
  "#6366f1", // indigo-500
  "#8b5cf6", // violet-500
  "#ec4899", // pink-500
  "#14b8a6", // teal-500
] as const;

/**
 * Deterministic 32-bit hash of a string. FNV-1a variant: good distribution
 * for short ids, trivial to implement, no dependencies.
 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Resolve the display color for a connection. Prefers the user-picked
 * `color` field; otherwise derives one deterministically from the id so
 * the same connection always gets the same color across sessions.
 */
export function getConnectionColor(conn: ConnectionConfig): string {
  if (conn.color) return conn.color;
  const idx = hashString(conn.id) % PALETTE.length;
  return PALETTE[idx]!;
}

/** Exposed for tests. */
export const CONNECTION_COLOR_PALETTE = PALETTE;
