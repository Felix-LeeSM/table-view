import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import type { EnvironmentTag } from "@/features/connection/model";

/**
 * Paradigm-agnostic Safe Mode decision matrix as a pure function.
 *
 * Sprint 245 (ADR 0022 Phase 1) — destructive-only policy. Sprint 244's
 * "production+strict|off = read-only" was reverted because production
 * INSERT / UPDATE WHERE / CREATE / ALTER additive flow blocked too much
 * day-to-day work and the dialog surface fragmented (block / confirm /
 * read-only-toast). The new matrix:
 *
 *   - destructive (DROP / TRUNCATE / ALTER DROP / WHERE-less DELETE·UPDATE
 *     and Mongo $out / $merge / drop / *-all variants — anything the
 *     analyzer marks `severity === "danger"`):
 *       * production + strict / warn → confirm with bare analyzer reason
 *         (rendered verbatim by the single-click Yes/No confirm dialog —
 *         Sprint 246, Phase 2 replaced the earlier type-to-confirm gate)
 *       * production + off            → confirm with prod-auto copy
 *         (preserves the distinguishing "off can't bypass production"
 *         hint inherited from Sprint 190's hard-auto policy)
 *       * non-prod + strict           → confirm with strict-mode copy
 *         (M.1 NEW flow — shared-staging / learning environments)
 *       * non-prod + warn / off       → allow
 *
 *   - non-destructive writes (INSERT / UPDATE WHERE / DELETE WHERE /
 *     CREATE / ALTER additive / Mongo *-many): always allow, no dialog.
 *     Cmd+Z undoes *uncommitted* grid edits only
 *     (`dataGridEditStore.undoStack`, Sprint 249); once committed, a safe
 *     write is not recoverable. Phase 5 compensating-commit undo is not
 *     yet implemented (#1126) — do not claim commits can be reverted.
 *
 *   - read (SELECT / WITH / Mongo read pipeline): always allow.
 *
 *   - environment === null (connection store hasn't hydrated): treated as
 *     non-production / allow. Defensive — the Mongo aggregate path can
 *     fire before `connectionStore` populates.
 *
 * Mode 3-tier (`strict` / `warn` / `off`) keeps its store / UI shape; only
 * the *meaning* changed:
 *   - strict: destructive dialog in *all* environments (incl. dev).
 *   - warn (default): destructive dialog in production only.
 *   - off: prod-auto — production still confirms (with prod-auto copy);
 *     non-prod is unguarded (safe writes + destructive both allowed).
 *
 * Block action survives in the type union for the Mongo single-node
 * fallback (where dry-run is unavailable). This function never returns
 * `block`; production destructive always returns `confirm` so the dialog
 * UI can take over uniformly.
 */
export type SafeMode = "strict" | "warn" | "off";

export type SafeModeDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "confirm"; reason: string };

export function decideSafeModeAction(
  mode: SafeMode,
  // #1114 — `EnvironmentTag | null`, not a raw string: callers must
  // canonicalize (via `resolveSafeModeEnvironment` / `canonicalEnvironmentTag`)
  // before deciding, so the `=== "production"` guard is compiler-checked and a
  // look-alike tag ("Production", "prod") can never reach this comparison.
  environment: EnvironmentTag | null,
  analysis: StatementAnalysis,
): SafeModeDecision {
  const isProduction = environment === "production";
  // Sprint 254 (2026-05-09) — `severity` union split to 3-tier:
  // `info` (read / metadata) / `warn` (bounded write surface) / `danger`
  // (STOP). The matrix *result* is regression-zero — INFO and WARN both
  // pass through here (`action: "allow"`); the WARN-tier raw editor
  // SqlPreviewDialog mount is QueryTab-level (Sprint 255) so the
  // decision function only differentiates STOP. ADR 0023 grill Q2-(a).
  const isDanger = analysis.severity === "danger";

  // Read / WARN write are never gated at the `decideSafeModeAction` layer.
  // Pass-through everywhere — the QueryTab's `pendingRdbWarn` /
  // `pendingMongoWarn` (Sprint 255) catches WARN at a higher surface.
  if (!isDanger) return { action: "allow" };

  // From here on: destructive (`severity === "danger"`).
  const reason = analysis.reasons[0] ?? "Dangerous statement";

  if (isProduction) {
    if (mode === "off") {
      // prod-auto — the toolbar "off" toggle is a no-op on production
      // connections. Distinguishing copy points at the connection
      // environment tag rather than the toolbar override.
      return {
        action: "confirm",
        reason: `${reason} (production environment forces Safe Mode — change connection environment tag to override)`,
      };
    }
    // strict / warn on production share the analyzer's bare reason — the
    // single-click Yes/No confirm dialog (Sprint 246, Phase 2) renders it
    // verbatim.
    return { action: "confirm", reason };
  }

  // Non-production destructive. Strict opts users into the dialog
  // everywhere (M.1 — shared-staging / learning environments); warn /
  // off are unguarded so dev workflows aren't disrupted.
  if (mode === "strict") {
    return {
      action: "confirm",
      reason: `${reason} (Safe Mode strict — destructive statement in non-production)`,
    };
  }

  return { action: "allow" };
}
