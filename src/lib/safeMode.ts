import type { StatementAnalysis } from "@/lib/sql/sqlSafety";

/**
 * Paradigm-agnostic Safe Mode decision matrix as a pure function.
 * Production connections cannot disable Safe Mode by toggling "off" —
 * `off` collapses to `strict` for production but stays effective on
 * local / testing / development / staging.
 *
 * Decision rules:
 *
 *   analysis.severity === "safe"      →  allow
 *   environment !== "production"      →  allow  (null ⇒ non-production)
 *   mode === "warn" + danger (prod)   →  confirm (reason verbatim)
 *   mode === "strict" + danger (prod) →  block  (toolbar-override copy)
 *   mode === "off" + danger (prod)    →  block  (prod-auto copy)
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
  const primary = analysis.reasons[0] ?? "Dangerous statement";
  if (mode === "warn") {
    return { action: "confirm", reason: primary };
  }
  if (mode === "off") {
    // The toolbar "off" toggle is a no-op on production. Surface a
    // different override path (change the connection environment tag)
    // so the user knows the toolbar won't help here.
    return {
      action: "block",
      reason: `Safe Mode blocked: ${primary} (production environment forces Safe Mode — change connection environment tag to override)`,
    };
  }
  return {
    action: "block",
    reason: `Safe Mode blocked: ${primary} (toggle Safe Mode off in toolbar to override)`,
  };
}
