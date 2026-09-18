/**
 * `datagrid_column_prefs` IPC frontend wrapper.
 *
 * Strategy doc Q20.4 + Q20.5 (field-scoped reset). Three commands:
 *
 *   - {@link setDatagridPrefs} — partial patch. At least one of `widths`
 *     or `hiddenColumns` is required. Empty patch → backend 400
 *     (`AppError::Validation`).
 *   - {@link getDatagridPrefs} — once on mount, or refetch on event.
 *     With no row: `{ widths: {}, hiddenColumns: [], updatedAt: null }`.
 *   - {@link resetDatagridPrefs} — per-field branching (`widths` /
 *     `hiddenColumns` / `all`). The two affordances are independent —
 *     resetting widths never unhides columns, nor the reverse.
 *
 * All wrappers use the camelCase wire. The backend's
 * `serde rename_all = "camelCase"` maps to snake_case.
 */

import { invoke } from "@tauri-apps/api/core";

/** 5-tuple primary key matching `datagrid_column_prefs` schema. */
export interface ColumnPrefsPk {
  connectionId: string;
  paradigm: "rdb" | "document";
  dbName: string;
  namespace: string;
  tableName: string;
}

/**
 * Partial-patch payload. At least one of `widths` / `hiddenColumns` is
 * required. Omitted fields keep the SQLite row's existing values. An
 * empty patch (both `widths` and `hiddenColumns` `undefined`) is
 * rejected by the backend with `AppError::Validation`.
 *
 * Callers must skip this IPC entirely when neither widths nor
 * hiddenColumns changed.
 */
export type SetDatagridPrefsRequest = ColumnPrefsPk & {
  widths?: Record<string, number>;
  hiddenColumns?: string[];
};

export interface GetDatagridPrefsResponse {
  widths: Record<string, number>;
  hiddenColumns: string[];
  updatedAt: number | null;
}

export type ResetField = "widths" | "hiddenColumns" | "all";

export type ResetDatagridPrefsRequest = ColumnPrefsPk & {
  field: ResetField;
};

export async function setDatagridPrefs(
  req: SetDatagridPrefsRequest,
): Promise<void> {
  // Backend serde flattens PK + patch fields into a single object.
  await invoke("set_datagrid_prefs", { req });
}

export async function getDatagridPrefs(
  pk: ColumnPrefsPk,
): Promise<GetDatagridPrefsResponse> {
  return await invoke<GetDatagridPrefsResponse>("get_datagrid_prefs", { pk });
}

export async function resetDatagridPrefs(
  req: ResetDatagridPrefsRequest,
): Promise<void> {
  await invoke("reset_datagrid_prefs", { req });
}
