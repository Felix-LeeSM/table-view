import type { StatementAnalysis } from "@/lib/sqlSafety";

/**
 * Sprint 189 (D-4) — paradigm-agnostic Safe Mode decision matrix as a pure
 * function. Extracted from `useSafeModeGate` so the matrix can be unit-tested
 * without `renderHook` + store mutations, and reused outside of React if
 * needed (e.g. preview-only audits).
 *
 * Decision rules (mirror Sprint 188 RDB inline gates verbatim):
 *
 *   analysis.severity === "safe"     →  allow
 *   environment !== "production"     →  allow  (null / missing connection ⇒
 *                                              treated as non-production)
 *   mode === "off"                   →  allow
 *   mode === "strict" + danger       →  block  (canonical reason text)
 *   mode === "warn" + danger         →  confirm (reason verbatim from analysis)
 */
export type SafeMode = "strict" | "warn" | "off";

export type SafeModeDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "confirm"; reason: string };

export function decideSafeModeAction(
  mode: SafeMode,
  environment: string | null,
  analysis: StatementAnalysis,
): SafeModeDecision {
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
  return { action: "confirm", reason: primary };
}
