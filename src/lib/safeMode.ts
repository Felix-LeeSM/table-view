import type { EnvironmentTag } from "@/features/connection/model";
import type { Severity, StatementAnalysis } from "@/lib/sql/sqlSafety";

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
 * the *meaning* changed. The dialog in the bullets below is the confirm
 * dialog this function asks for — the preview dialog (`requiresPreviewDialog`
 * below) is a separate surface and does not follow this table:
 *   - strict: destructive confirm in *all* environments (incl. dev).
 *   - warn (default): destructive confirm in production only.
 *   - off: prod-auto — production still confirms (with prod-auto copy);
 *     non-prod returns `allow` for safe writes and destructive alike.
 *
 * Since #2375 an `allow` here is not the end of the story in the raw SQL / MQL
 * editor: it runs its own preview gate (`requiresPreviewDialog` below) after
 * this one, so `DROP TABLE t` on a non-production connection under `warn` /
 * `off` opens `SqlPreviewDialog` instead of reaching the driver. That gate is
 * the editor's surface, not this matrix — the Redis command console
 * (`src/components/query/QueryTab/kvQueryExecution.ts`) mounts no preview and
 * since #2421 routes the data-loss commands to the confirm dialog on its own
 * instead, again above this matrix rather than inside it. #2513 widened the set
 * that gets that routing from `DEL` alone to every verb the backend calls
 * destructive (`HDEL`, `LREM`, `SREM`, `ZREM`, `XDEL`, `XTRIM`): they used to
 * reach this matrix as `info`, because `analyzeKvCommandSafety` looks the typed
 * verb up in `KV_CONFIRM_COMMANDS` and they were absent, so `allow` came back
 * for them even on production + `strict`. A KV command outside that map still
 * dispatches straight away when this function returns `allow`.
 *
 * Which analyzer ran decides, never the verb alone: the KV structure editor
 * (`KvKeyDetailPanel` / `KvMutationPanel`) reaches `danger` for the same
 * removals by its own route, reading the mutation's `destructive` flag rather
 * than a verb (`analyzeKvMutationSafety` in
 * `src/components/workspace/kvMutationCommands.ts`). That the two routes land
 * on the same tier is asserted per verb in
 * `src/components/query/QueryTab/kvDestructiveTier.test.ts`. Read a claim about
 * this matrix's answer as a claim about the analysis handed to it; see
 * `docs/product/known-limitations-cross-cutting.md`.
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
  // pass through here (`action: "allow"`); the raw editor SqlPreviewDialog
  // mount is QueryTab-level (Sprint 255) so the decision function only
  // differentiates STOP. ADR 0023 grill Q2-(a). Issue #2375 widened that
  // QueryTab-level mount from WARN-tier to every non-INFO tier
  // (`requiresPreviewDialog` below) without touching this matrix.
  const isDanger = analysis.severity === "danger";

  // Read / WARN write are never gated at the `decideSafeModeAction` layer.
  // Pass-through everywhere — the QueryTab's `pendingRdbWarn` /
  // `pendingMongoWarn` (Sprint 255) catches them at a higher surface; since
  // #2375 that surface gates on `requiresPreviewDialog` (below) rather than
  // on the WARN tier.
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

/**
 * Issue #2375 — the QueryTab preview-dialog gate. Every write surface that
 * mounts `pendingRdbWarn` / `pendingMongoWarn` asks this function instead of
 * testing `severity` against a literal itself.
 *
 * Why it isn't just the WARN tier: `decideSafeModeAction` above returns
 * `allow` for a destructive statement on a non-production connection under
 * Safe Mode `warn` (the shipped default) or `off`, and that pass-through is
 * deliberate (ADR 0022 — dev workflows aren't disrupted). Each mount used to
 * gate on the WARN tier alone, so those allowed destructive statements fell
 * past the preview and reached the driver with no dialog at all: on the
 * shipped default `DELETE FROM t WHERE a = 1` (warn) got a preview while
 * `DROP TABLE t` (danger) got nothing. Friction ran backwards against tier.
 *
 * The test is `!== "info"` rather than an enumeration of the tiers that need
 * a dialog, so a tier added to `Severity` later gets the preview by default
 * instead of silently inheriting the hole this closed.
 *
 * `src/lib/safeMode.previewGate.test.ts` reads the dispatch sources and fails
 * if any file that mounts the preview compares a value against the `warn`
 * string literal.
 */
export function requiresPreviewDialog(severity: Severity): boolean {
  return severity !== "info";
}

/**
 * Issue #2375 — baseline test for the dry-run impact escalation
 * (`escalateWarnIfLargeImpact`, which takes `"warn"` as the severity the
 * probe starts from). Deliberately narrower than `requiresPreviewDialog`:
 * only a WARN-tier bounded write can be *raised* by a row-count probe. A
 * DANGER statement is already at the top tier, so probing it would bill a
 * dry-run count query for a decision that cannot change and would hand the
 * helper a starting severity it does not hold.
 *
 * Kept as its own predicate so that widening the preview gate cannot widen
 * the escalation gate by accident — one flag used to drive both.
 */
export function canEscalateByImpact(severity: Severity): boolean {
  return severity === "warn";
}
