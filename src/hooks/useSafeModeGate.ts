import { useCallback } from "react";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import { decideSafeModeAction, type SafeModeDecision } from "@/lib/safeMode";

/**
 * Paradigm-agnostic Safe Mode gate. Pure store wiring around
 * `decideSafeModeAction` (`src/lib/safeMode.ts`); both Mongo aggregate
 * and the RDB grid / DDL editors share the same decision matrix.
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
 * Strict-mode read-only gate for the DataGrid editor.
 *
 * Whereas `useSafeModeGate` is a *per-statement* dangerous-DML
 * classifier (block WHERE-less DELETE / DDL drops at commit time),
 * this hook answers a coarser policy question: "should the grid
 * disable cell editing entirely?".
 *
 * The dangerous-statement gate alone is insufficient for the user
 * expectation reported on 2026-05-08 — `UPDATE ... WHERE pk = ?`
 * (the cell-edit shape) classifies as `safe` and so passes through
 * the per-statement gate, even though the user expects strict mode
 * on production to be a *read-only* guarantee. This hook returns
 * `true` whenever:
 *
 *   - `environment === "production"` AND
 *   - effective mode is `strict` OR `off` (prod-auto upgrade)
 *
 * `warn` is permissive — edits flow through, the warn-tier confirm
 * dialog handles the dangerous-DML cases.
 *
 * Non-production connections always return `false` regardless of
 * mode (the local/dev override path is intentional).
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
