import type { StatementAnalysis } from "@/lib/sql/sqlSafety";

/**
 * Sprint 189 (D-4) — paradigm-agnostic Safe Mode decision matrix as a pure
 * function. Extracted from `useSafeModeGate` so the matrix can be unit-tested
 * without `renderHook` + store mutations, and reused outside of React if
 * needed (e.g. preview-only audits).
 *
 * Sprint 190 (FB-1b) — Hard auto policy. `production` connections cannot
 * disable Safe Mode by toggling the toolbar to "off"; `off` is treated as
 * `strict` for production. Off remains effective on local / testing /
 * development / staging — the global toggle still serves non-production
 * workflows.
 *
 * Decision rules:
 *
 *   analysis.severity === "safe"     →  allow
 *   environment !== "production"     →  allow  (null / missing connection ⇒
 *                                              treated as non-production)
 *   mode === "warn" + danger (prod)  →  confirm (reason verbatim)
 *   mode === "strict" + danger (prod) →  block  (toolbar-override copy)
 *   mode === "off" + danger (prod)   →  block  (prod-auto copy — Sprint 190)
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
    // Sprint 190 (AC-190-02) — prod-auto. The toolbar "off" toggle is a
    // no-op on production connections, so we surface a different override
    // path (change the connection environment tag) than the strict copy.
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
