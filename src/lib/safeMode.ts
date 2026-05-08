import type { StatementAnalysis, StatementKind } from "@/lib/sql/sqlSafety";

/**
 * Paradigm-agnostic Safe Mode decision matrix as a pure function.
 * Production connections cannot disable Safe Mode by toggling "off" —
 * `off` collapses to `strict` for production but stays effective on
 * local / testing / development / staging.
 *
 * Decision rules (Sprint 244 — read-only policy):
 *
 *   environment !== "production"        →  allow  (null ⇒ non-production)
 *   mode === "warn" (prod)              →  severity-driven (safe→allow, danger→confirm)
 *   mode === "strict"|"off" (prod)      →  read-only — SQL writes/DDL are
 *     blocked even when the analyzer marks them severity=safe (UPDATE
 *     ...WHERE pk, INSERT, CREATE TABLE). Strict's purpose is "no writes
 *     at all on production"; the analyzer's safe-severity is about
 *     mass-mutation risk, not write-vs-read. Mongo writes still funnel
 *     through severity=danger ($out / $merge / delete-all / etc.) so
 *     they're caught by the danger branch. Mongo read pipelines remain
 *     allowed (mongo-other + safe).
 */
export type SafeMode = "strict" | "warn" | "off";

export type SafeModeDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "confirm"; reason: string };

// SQL kinds that mutate state. Even when the analyzer's severity is
// `safe` (e.g. UPDATE with WHERE, INSERT, CREATE TABLE), strict / off
// on production blocks them — Safe Mode strict means read-only.
const SQL_WRITE_KINDS: ReadonlySet<StatementKind> = new Set<StatementKind>([
  "insert",
  "update",
  "delete",
  "ddl-drop",
  "ddl-truncate",
  "ddl-alter-drop",
  "ddl-other",
]);

export function decideSafeModeAction(
  mode: SafeMode,
  environment: string | null,
  analysis: StatementAnalysis,
): SafeModeDecision {
  if (environment !== "production") return { action: "allow" };

  const isSqlWrite = SQL_WRITE_KINDS.has(analysis.kind);
  const isDanger = analysis.severity === "danger";

  if (mode === "strict" || mode === "off") {
    if (!isSqlWrite && !isDanger) return { action: "allow" };
    const fallback = isDanger
      ? "Dangerous statement"
      : `${analysis.kind.toUpperCase()} statement`;
    const primary = analysis.reasons[0] ?? fallback;
    if (mode === "off") {
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

  // mode === "warn" — severity-driven. Write-with-WHERE statements stay
  // friction-free; only analyzer-flagged danger triggers a confirm.
  if (!isDanger) return { action: "allow" };
  const primary = analysis.reasons[0] ?? "Dangerous statement";
  return { action: "confirm", reason: primary };
}
