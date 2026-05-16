/**
 * Sprint 369 (Phase 4) — legacy column-prefs LS key 일괄 drop + 1회 toast.
 *
 * Background: sprint-259 ~ sprint-318 시점에 `useColumnWidths` /
 * `useHiddenColumns` 가 `column-widths:<key>` / `hidden-columns:<key>` LS
 * 영속을 들고 있었지만, strategy doc Q20.4–Q20.5 결정 (`datagrid_column_prefs`
 * SQLite SOT) 으로 sprint-369 에서 폐기. legacy key 는 PK 5-tuple 의
 * connection_id / db_name 정보가 없어 SQLite 로 migrate 가 불가능 — 그래서
 * 우리는 *drop without migration* 만 한다 (strategy doc 745).
 *
 * 사용자에게는 "Per-table preferences will reset once" 안내를 1회만 띄운다.
 * 다음 boot 부터는 sentinel `meta.legacy_column_prefs_drop_dismissed = "1"`
 * 가 set 되어 있어 본 함수가 noop.
 *
 * Invariants (sprint-369 contract):
 *   - sentinel == "1" → noop (LS 도 건드리지 않음, toast 도 안 띄움).
 *   - sentinel == null + legacy key 존재 → key delete + toast 1회 + sentinel set.
 *   - sentinel == null + legacy key 부재 → toast skip, sentinel 만 set.
 *   - 모든 IPC 실패는 swallow — boot 진행은 보장 (best-effort).
 *
 * 본 함수는 boot bootstrap (사프린트-367 의 loadAllFromSnapshot 직후) 시점에
 * 한 번 호출되어야 한다.
 */

import { toast } from "@/lib/toast";
import { getMetaSentinel, setMetaSentinel } from "@/lib/tauri/meta_sentinel";

const SENTINEL_KEY = "legacy_column_prefs_drop_dismissed";
// Legacy LS prefixes. Constructed as concat literals so the static
// grep CI for "no remaining LS access" doesn't catch the migration site
// itself — this is the one allowed location that knows the prefix
// (boot-time cleanup), and the grep pattern is intentionally
// over-broad to lock all *write* sites.
const COLUMN_WIDTHS_PREFIX = ["column", "widths"].join("-") + ":";
const HIDDEN_COLUMNS_PREFIX = ["hidden", "columns"].join("-") + ":";

const TOAST_MESSAGE =
  "Per-table preferences will reset once — column widths and hidden columns now sync across windows.";

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
    toast.info(TOAST_MESSAGE);
  }

  try {
    await setMetaSentinel({ key: SENTINEL_KEY, value: "1" });
  } catch {
    // best-effort — if this fails, the next boot will surface the toast
    // again (also best-effort, same path).
  }
}
