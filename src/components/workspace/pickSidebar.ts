import type { Paradigm } from "@/types/connection";

/**
 * The runtime-discriminator used by `<WorkspaceSidebar>` to pick which
 * paradigm-specific sidebar to mount once a connection has been resolved
 * and is "connected". The value space deliberately tracks the
 * {@link Paradigm} union 1-to-1 (no merging or relabelling) so adding a
 * future paradigm requires touching exactly one switch arm here.
 *
 * This type is exported so {@link WorkspaceSidebar} can type its lookup
 * table without importing the wider `Paradigm` union directly.
 */
export type SidebarKind = "rdb" | "document" | "kv" | "search";

/**
 * Pure paradigm → sidebar-kind mapping. Sprint 126 lifts the conditional
 * `isDocument ? DocumentDatabaseTree : SchemaTree` branch out of
 * `SchemaPanel` into a 4-way map so paradigms with no real sidebar yet
 * (`kv` / `search`) can route to a placeholder without an `if` chain in
 * the consumer.
 *
 * Kept as a top-level pure function (not a hook) so unit tests can
 * exercise the mapping without rendering anything.
 */
export function pickSidebar(paradigm: Paradigm): SidebarKind {
  switch (paradigm) {
    case "rdb":
      return "rdb";
    case "document":
      return "document";
    case "kv":
      return "kv";
    case "search":
      return "search";
  }
}
