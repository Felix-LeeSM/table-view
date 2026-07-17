/**
 * Safe Mode SQL classifier — barrel.
 *
 * Consumers import from `./sqlSafety` (or `@lib/sql/sqlSafety`); this barrel
 * keeps that surface stable while the implementation is split by concern:
 *
 * - `sqlSafetyTypes.ts` — `Severity` / `StatementKind` / `StatementAnalysis`
 *   / `StatementAnalysisOptions` public shapes.
 * - `sqlSafetyNormalize.ts` — literal/comment-aware comment stripping,
 *   whitespace normalization, and the WHERE / batch / T-SQL scanners.
 * - `sqlSafetyClassifier.ts` — the AST-first, regex-fallback classifier
 *   (`analyzeStatement`) plus the `isDangerous` / `isInfoStatement` helpers.
 *
 * Only the four public types and three public functions are re-exported here;
 * the split-module scanners and the AST → analysis mapper stay internal to
 * their concern (a blanket `export *` would leak them into the public API).
 */

export type {
  Severity,
  StatementAnalysis,
  StatementAnalysisOptions,
  StatementKind,
} from "./sqlSafetyTypes";
export {
  analyzeStatement,
  isDangerous,
  isInfoStatement,
} from "./sqlSafetyClassifier";
