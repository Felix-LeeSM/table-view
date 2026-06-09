# Refactor 00 Static Hardening Plan

Issue: #578
Parent: #571
Milestone: 09.00 - Refactor 00 - Test And Static Hardening Baseline
Baseline artifact: `docs/archives/audits/refactor-00-baseline-2026-06-09.md`
Base: `da25bf304dadb9dec4a10927c18a127a21483b7c`

This file is issue evidence for #578. The active developer-facing gate summary
lives in `docs/contributor-guide/testing-and-quality.md`.

## Measured Static Baseline

| Check | Result | Owner / action |
|---|---:|---|
| `pnpm exec eslint . --format json` | 909 reported files, 0 errors, 22 warnings | #578 turns this into an exact allowlist gate. |
| ESLint warning rules | `max-lines` only | Existing debt stays warning-level; allowlist growth fails `pnpm lint`. |
| TS/TSX lint visibility audit | 906 source/e2e/scripts/tests candidates; hidden paths were generated SQL wasm `.d.ts` files | #578 makes generated wasm ignores symmetric and explicit. |
| Import boundary | No existing `src/features/**` files or boundary rule | #578 adds the first-stage boundary for future feature migration. |

The initial hidden TS/TSX paths were generated artifacts:

- `src/lib/sql/wasm/sql_parser_core.d.ts`
- `src/lib/sql/wasm/sql_parser_core_bg.wasm.d.ts`

After #578, both SQL and Mongo wasm generated directories are explicit ESLint
ignores. `scripts/check-eslint-static-policy.ts` fails if any ignored TS/TSX
candidate is outside those generated directories.

## Max-Lines Allowlist

`max-lines` remains `warn` in ESLint config because current debt is known and
measured. `pnpm lint` now enforces the exact allowlist through
`scripts/check-eslint-static-policy.ts`:

- new `max-lines` warning outside this list: fail
- stale allowlist entry after a file shrinks below the threshold: fail
- any non-`max-lines` warning: fail

| File | Owner lane | Shrink path |
|---|---|---|
| `e2e/smoke/_helpers.ts` | #581 E2E breadth/runtime | Split smoke helper by fixture/runtime action before adding more specs. |
| `src/components/connection/ConnectionDialog.test.tsx` | Connection UI refactor | Split DBMS-specific form cases when connection dialog migration resumes. |
| `src/components/connection/ConnectionGroup.test.tsx` | Connection list refactor | Split grouping/reset affordance scenarios by behavior. |
| `src/components/connection/ConnectionItem.test.tsx` | Connection list refactor | Split item action/status/dropdown scenarios by behavior. |
| `src/components/datagrid/sqlGenerator.test.ts` | Datagrid SQL generation | Split dialect/edit-mode fixtures by DBMS family. |
| `src/components/datagrid/useDataGridEdit.mixed-batch.test.ts` | Datagrid edit refactor | Split mixed-batch preview/commit/error scenarios. |
| `src/components/document/DocumentTreePanel.test.tsx` | Document workbench refactor | Split nested tree/edit/selection behavior. |
| `src/components/document/DocumentTreePanel.tsx` | Document workbench refactor | Extract tree state/action hooks before new document UI work. |
| `src/components/layout/MainArea.test.tsx` | Workspace layout refactor | Split tab lifecycle and paradigm rendering cases. |
| `src/components/layout/TabBar.test.tsx` | Workspace layout refactor | Split dirty, drag, close, and focus behavior. |
| `src/components/query/QueryTab/useQueryExecution.ts` | Query runtime refactor | Extract source-specific execution use-cases before adding new source behavior. |
| `src/components/rdb/DataGrid.editing.test.tsx` | RDB grid edit refactor | Split edit visual, preview, commit, and failure paths. |
| `src/components/schema/CreateTableDialog.test.tsx` | Schema DDL refactor | Split table/index/constraint scenario groups. |
| `src/components/schema/CreateTableDialog.tsx` | Schema DDL refactor | Extract DDL form state and preview/confirmation hooks. |
| `src/components/schema/SchemaTree.actions.test.tsx` | Schema tree refactor | Split action menu/export/delete cases. |
| `src/components/shared/QuickLookPanel.test.tsx` | Shared inspection UI | Split JSON/BSON/blob/value scenarios. |
| `src/hooks/useSqlAutocomplete.test.ts` | SQL completion refactor | Split catalog, dialect, and WASM bridge scenarios. |
| `src/lib/mongo/mongoshParser.test.ts` | Mongo language refactor | Split parser mode and unsupported helper cases. |
| `src/lib/sql/sqlAst.test.ts` | SQL parser/safety refactor | Split AST fixture families. |
| `src/lib/sql/sqlSafety.test.ts` | SQL parser/safety refactor | Split safety category and dialect scenario groups. |
| `src/stores/connectionStore.test.ts` | Store/runtime refactor | Split persistence, lifecycle, and sync behavior. |
| `src/stores/schemaStore.test.ts` | Store/runtime refactor | Split cache, mismatch, and scope behavior. |

Promotion to `max-lines: error` is blocked until production files are removed
from this allowlist and the remaining test debt has owner issues under the
active refactor milestone. Until then, exact allowlist enforcement prevents new
god-file debt from hiding behind the warning severity.

## Import-Boundary Stages

| Stage | Enforcement | Non-goal |
|---|---|---|
| B0, #578 | Add `@features/*` resolution and `tv-local/no-feature-legacy-imports` for `src/features/**/*.{ts,tsx}`. Future feature modules may depend on feature-local code, `@lib`, `@/types`, and `@components/ui`. | No legacy source movement. |
| B1, first migration PR | Move one bounded UI/runtime area into `src/features/<area>` and keep the feature rule green. Add targeted tests for that migrated area. | Do not enforce final C boundaries on legacy roots. |
| C, after migration scaffolding | Expand import-boundary checks from feature modules to the whole frontend graph. | Do not use broad `eslint-disable` or global ignores as migration shortcuts. |

The rule blocks feature imports from legacy component roots, hooks, stores,
pages, router, and app shell paths. It deliberately does not block current
legacy roots because the migration scaffold does not exist yet.

## Gate Owner, Runtime, Triage

| Gate | Runtime baseline | Owner | Triage |
|---|---:|---|---|
| `pnpm lint` / `scripts/check-eslint-static-policy.ts` | ESLint baseline was 5.36s before wrapper; wrapper adds one exact-policy pass. | #578 for policy; touched-area owner for new failures. | Fix new errors/warnings in the changing PR. If a file shrinks, remove its stale allowlist entry in the same PR. |
| `src/features/**` import boundary | Runs inside `pnpm lint`. | First frontend migration issue under #571. | Move code feature-local, depend on `@lib`/`@/types`/`@components/ui`, or promote a reusable primitive before importing it. |
| Coverage thresholds | Not changed here. | #579/#580. | Add tests before threshold raises. |
| E2E breadth/runtime | Not changed here. | #581. | Add smoke specs only with runtime budget and fixture owner. |
| CI cache/parallelism | Not changed here. | #582. | Keep workflow/cache edits out of #578. |

## Out Of Scope

- No CI workflow or cache edits.
- No coverage threshold changes or coverage test additions.
- No source decomposition in the 22 allowlisted files.
- No final-C frontend import boundary on legacy roots.
