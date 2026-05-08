import { useCallback } from "react";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import { decideSafeModeAction, type SafeModeDecision } from "@/lib/safeMode";

/**
 * Paradigm-agnostic Safe Mode gate. Pure store wiring around
 * `decideSafeModeAction` (`src/lib/safeMode.ts`); both Mongo aggregate
 * and the RDB grid / DDL editors share the same decision matrix.
 *
 * Policy (Sprint 244):
 *
 * | env             | mode           | statement                     | result   |
 * |-----------------|----------------|-------------------------------|----------|
 * | non-production  | *              | *                             | allow    |
 * | production      | warn           | safe (incl. INSERT/UPDATE-WHERE) | allow    |
 * | production      | warn           | danger (DROP, DELETE w/o WHERE, $out) | confirm |
 * | production      | strict / off   | SELECT, Mongo read pipeline   | allow    |
 * | production      | strict / off   | any SQL write/DDL or Mongo write | block |
 *
 * Strict / off on production is **read-only** — the prior
 * "dangerous-only" interpretation (Sprint 185 / 231) was tightened by
 * Sprint 243 (DataGrid cell edits) and Sprint 244 (raw SQL editor)
 * after a user report that `UPDATE ... WHERE pk` and `INSERT INTO`
 * still ran under strict.
 */
export type { SafeModeDecision };

export interface SafeModeGate {
  decide(analysis: StatementAnalysis): SafeModeDecision;
}

export function useSafeModeGate(connectionId: string | null): SafeModeGate {
  const mode = useSafeModeStore((s) => s.mode);
  const environment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );

  const decide = useCallback(
    (analysis: StatementAnalysis) =>
      decideSafeModeAction(mode, environment, analysis),
    [mode, environment],
  );

  return { decide };
}

/**
 * UI fast-path for the read-only Safe Mode policy.
 *
 * `useSafeModeGate` returns a per-statement decision (allow / confirm
 * / block). For the DataGrid we need a single boolean *before* any
 * statement is built — so the toolbar can render Add/Delete/Duplicate
 * as `disabled` and the cell-edit double-click can short-circuit with
 * a toast — and the answer must match the lib decision matrix exactly
 * for SQL writes (otherwise we'd get a UI/lib divergence where the
 * toolbar enables editing but the commit-preview SQL path then blocks).
 *
 * Returns `true` (read-only) iff:
 *
 *   - `environment === "production"` AND
 *   - effective mode is `strict` OR `off` (prod-auto upgrade)
 *
 * This boolean is the same predicate the lib's `decideSafeModeAction`
 * uses to route SQL writes to `block` (Sprint 244). `warn` mode is
 * permissive — edits flow through and the warn-tier confirm dialog
 * handles analyzer-flagged danger. Non-production always returns
 * `false`.
 */
export function useSafeModeReadOnly(connectionId: string | null): boolean {
  const mode = useSafeModeStore((s) => s.mode);
  const environment = useConnectionStore(
    (s) =>
      s.connections.find((c) => c.id === connectionId)?.environment ?? null,
  );
  if (environment !== "production") return false;
  return mode === "strict" || mode === "off";
}
