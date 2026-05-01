import { useCallback } from "react";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sqlSafety";
import { decideSafeModeAction, type SafeModeDecision } from "@/lib/safeMode";

/**
 * Sprint 188 — paradigm-agnostic Safe Mode gate.
 * Sprint 189 (D-4) — decision matrix moved to `decideSafeModeAction`
 * (`src/lib/safeMode.ts`); this hook is now pure store wiring.
 *
 * Consumed by:
 * - Mongo aggregate (Sprint 188 — QueryTab)
 * - RDB 5 sites (Sprint 189 — useDataGridEdit, EditableQueryResultGrid,
 *   ColumnsEditor, IndexesEditor, ConstraintsEditor)
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
