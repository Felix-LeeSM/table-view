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
