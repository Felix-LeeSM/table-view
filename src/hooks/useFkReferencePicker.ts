import { useCallback } from "react";

import { useSchemaStore } from "@stores/schemaStore";

/**
 * Sprint 229 — small lifecycle hook for the FK reference table /
 * column lazy-load.
 *
 * Why a hook (not direct `getState()` in the modal):
 * - Lint rule `no-restricted-syntax` (eslint.config.js, 2026-05-05)
 *   forbids `store.getState()` inside `src` tsx files. Selector hooks
 *   are reactive; this is a one-shot imperative call surface, so we
 *   wrap it in a `src/hooks` boundary the rule already permits.
 * - The schema store body itself stays unchanged — Sprint 224
 *   freeze. We expose only the existing API surface (`tables`,
 *   `tableColumnsCache`, `loadTables`, `getTableColumns`).
 *
 * Returned imperative ops:
 * - `ensureTablesLoaded(schema)` — calls `loadTables(connectionId,
 *   schema)` only when the cache is empty for the key.
 * - `loadColumnsIfMissing(schema, table)` — calls `getTableColumns`
 *   only when the columns cache is empty for the key. Returns the
 *   promise so the caller can flip a per-row loading flag around it.
 */
export function useFkReferencePicker(connectionId: string) {
  const ensureTablesLoaded = useCallback(
    (refSchema: string): Promise<void> => {
      const trimmed = refSchema.trim();
      if (trimmed.length === 0) return Promise.resolve();
      const key = `${connectionId}:${trimmed}`;
      const cached = useSchemaStore.getState().tables[key];
      if (cached && cached.length > 0) return Promise.resolve();
      return useSchemaStore.getState().loadTables(connectionId, trimmed);
    },
    [connectionId],
  );

  const loadColumnsIfMissing = useCallback(
    async (refSchema: string, refTable: string): Promise<boolean> => {
      const schema = refSchema.trim();
      const table = refTable.trim();
      if (schema.length === 0 || table.length === 0) return false;
      const cacheKey = `${connectionId}:${schema}:${table}`;
      const cached = useSchemaStore.getState().tableColumnsCache[cacheKey];
      if (cached && cached.length > 0) return false;
      try {
        await useSchemaStore
          .getState()
          .getTableColumns(connectionId, table, schema);
        return true;
      } catch {
        // Best-effort lazy load — failures fall through to the body's
        // free-text fallback (AC-229-09 graceful degradation).
        return false;
      }
    },
    [connectionId],
  );

  return { ensureTablesLoaded, loadColumnsIfMissing };
}
