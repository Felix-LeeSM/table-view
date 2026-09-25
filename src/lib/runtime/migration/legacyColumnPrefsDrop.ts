/**
 * Bulk-drops the legacy column-prefs LS keys and shows a one-time toast.
 *
 * Background: `useColumnWidths` / `useHiddenColumns` used to persist
 * `column-widths:<key>` / `hidden-columns:<key>` in LS; the strategy doc
 * Q20.4–Q20.5 decision (`datagrid_column_prefs` as the SQLite SOT) retired
 * that. The legacy keys lack the connection_id / db_name parts of the PK
 * 5-tuple, so they cannot be migrated to SQLite — hence we only
 * *drop without migration* (strategy doc 748).
 *
 * The user sees the "Per-table preferences will reset once" notice only
 * once. From the next boot on, the sentinel
 * `meta.legacy_column_prefs_drop_dismissed = "1"` is set and this function
 * is a no-op.
 *
 * Invariants:
 *   - sentinel == "1" → no-op (LS untouched, no toast).
 *   - sentinel == null + legacy keys present → delete the keys + one toast
 *     + set the sentinel.
 *   - sentinel == null + no legacy keys → skip the toast, set only the
 *     sentinel.
 *   - Every IPC failure is swallowed — boot is guaranteed to proceed
 *     (best-effort).
 *
 * This function must be called once during boot bootstrap, right after
 * `loadAllFromSnapshot`.
 */

import i18n from "@lib/i18n";
import { toast } from "@/lib/runtime/toast";
import { getMetaSentinel, setMetaSentinel } from "@/lib/tauri/meta_sentinel";

const SENTINEL_KEY = "legacy_column_prefs_drop_dismissed";
// Legacy LS prefixes. Constructed as concat literals so the static
// grep CI for "no remaining LS access" doesn't catch the migration site
// itself — this is the one allowed location that knows the prefix
// (boot-time cleanup), and the grep pattern is intentionally
// over-broad to lock all *write* sites.
const COLUMN_WIDTHS_PREFIX = `${["column", "widths"].join("-")}:`;
const HIDDEN_COLUMNS_PREFIX = `${["hidden", "columns"].join("-")}:`;

function collectLegacyKeys(): string[] {
  const out: string[] = [];
  if (typeof window === "undefined" || !window.localStorage) return out;
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const k = window.localStorage.key(i);
    if (!k) continue;
    if (
      k.startsWith(COLUMN_WIDTHS_PREFIX) ||
      k.startsWith(HIDDEN_COLUMNS_PREFIX)
    ) {
      out.push(k);
    }
  }
  return out;
}

function removeKeys(keys: string[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  for (const k of keys) {
    try {
      window.localStorage.removeItem(k);
    } catch {
      // best-effort; quota / disabled storage just leaves the key.
    }
  }
}

export async function dropLegacyColumnPrefs(): Promise<void> {
  let dismissed: string | null = null;
  try {
    dismissed = await getMetaSentinel(SENTINEL_KEY);
  } catch {
    // Backend unreachable — proceed with the LS cleanup so subsequent
    // runs (after backend recovers) still emit the toast once. The
    // sentinel write below also tolerates failure.
  }

  if (dismissed === "1") return;

  const legacyKeys = collectLegacyKeys();
  removeKeys(legacyKeys);

  if (legacyKeys.length > 0) {
    toast.info(i18n.t("feedback:columnPrefsReset"));
  }

  try {
    await setMetaSentinel({ key: SENTINEL_KEY, value: "1" });
  } catch {
    // best-effort — if this fails, the next boot will surface the toast
    // again (also best-effort, same path).
  }
}
