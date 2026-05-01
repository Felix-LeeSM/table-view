import { useCallback } from "react";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sqlSafety";

/**
 * Sprint 188 — paradigm-agnostic safe-mode decision helper.
 *
 * Centralises the strict / warn / off branching that 4 RDB call sites
 * (`useDataGridEdit`, `EditableQueryResultGrid`, `ColumnsEditor`,
 * `ConstraintsEditor`) currently inline. The Mongo aggregate gate is the
 * 5th site and enters via this hook so the pattern is captured once.
 *
 * Migration of the 4 RDB sites is intentionally out of scope for Sprint 188
 * (each site manages `ConfirmDangerousDialog` state differently —
 * regression risk is separated into a follow-up sprint).
 *
 * Decision matrix (mirrors RDB inline gates verbatim):
 *
 *   analysis.severity === "safe"  →  allow
 *   environment !== "production"  →  allow
 *   mode === "off"                →  allow
 *   mode === "strict"             →  block (with canonical reason text)
 *   mode === "warn"               →  confirm (caller mounts dialog)
 */
export type SafeModeDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "confirm"; reason: string };

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
    (analysis: StatementAnalysis): SafeModeDecision => {
      if (analysis.severity === "safe") return { action: "allow" };
      if (environment !== "production") return { action: "allow" };
      if (mode === "off") return { action: "allow" };
      const primary = analysis.reasons[0] ?? "Dangerous statement";
      if (mode === "strict") {
        return {
          action: "block",
          reason: `Safe Mode blocked: ${primary} (toggle Safe Mode off in toolbar to override)`,
        };
      }
      // mode === "warn"
      return { action: "confirm", reason: primary };
    },
    [mode, environment],
  );

  return { decide };
}
