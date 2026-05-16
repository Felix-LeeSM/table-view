/**
 * Sprint 369 (Phase 4) — `datagrid_column_prefs` IPC frontend wrapper.
 *
 * Strategy doc Q20.4 + Q20.5 + codex 7차 #1 (field-scoped reset). Three
 * commands:
 *
 *   - {@link setDatagridPrefs} — partial patch. `widths` or `hiddenColumns`
 *     중 하나 이상 필수. 빈 patch → backend 400 (`AppError::Validation`).
 *   - {@link getDatagridPrefs} — mount 시 1회 또는 event 수신 시 refetch.
 *     row 없으면 `{ widths: {}, hiddenColumns: [], updatedAt: null }`.
 *   - {@link resetDatagridPrefs} — field 별 분기 (`widths` / `hiddenColumns` /
 *     `all`). 두 affordance 가 서로 독립 — widths reset 이 hidden 풀거나 그 반대 0.
 *
 * 모든 wrapper 는 camelCase wire. Backend `serde rename_all = "camelCase"` 가
 * snake_case 로 매핑.
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
 * Partial-patch payload. `widths` 또는 `hiddenColumns` 중 하나 이상 필수.
 * 미포함 필드는 SQLite row 의 기존 값 유지. 빈 patch (`widths` / `hiddenColumns`
 * 둘 다 `undefined`) 는 backend 가 `AppError::Validation` 으로 reject (codex 8차 #5).
 *
 * 호출자는 widths 또는 hiddenColumns 변경 없으면 IPC 자체를 skip 해야 한다.
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
