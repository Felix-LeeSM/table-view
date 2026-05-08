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
 * Policy (Sprint 245 — ADR 0022 Phase 1, destructive-only):
 *
 * | env             | mode    | statement                       | result   |
 * |-----------------|---------|---------------------------------|----------|
 * | non-production  | strict  | destructive                     | confirm  |
 * | non-production  | strict  | safe write / read               | allow    |
 * | non-production  | warn    | *                               | allow    |
 * | non-production  | off     | *                               | allow    |
 * | production      | *       | safe write / read               | allow    |
 * | production      | strict  | destructive                     | confirm  |
 * | production      | warn    | destructive                     | confirm  |
 * | production      | off     | destructive                     | confirm  |
 *
 * Sprint 244's "production + strict | off = read-only" was reverted —
 * INSERT / UPDATE WHERE / CREATE / ALTER additive flow without a
 * confirm dialog on production. Cmd+Z (Phase 5) is the safety net for
 * commit-time safe writes; the destructive dialog (Phase 2) handles the
 * unrecoverable cases. See `src/lib/safeMode.ts` for the canonical
 * matrix + reason copy.
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
