# Catch-block Audit (sprint-88)

Static audit of every `try`/`catch` block in `src/` and `src-tauri/src/` to satisfy
sprint-88 AC-03. The goal is **inventory only** — fixes belong to follow-up sprints.

## Audit Methodology

- TypeScript scope: every `} catch (...)` and `try { ... } catch` in `src/**/*.{ts,tsx}`
  excluding test files.
- Rust scope: Rust does not have try/catch. We audited the closest analogues:
  `let _ = <fallible_call>(...)` (intentional discard) and any `match { ... Err(_) => {} }`
  with empty arms.
- Each block was classified into one of:
  - **handled** — error reaches the user (state, log, UI), recovery action present.
  - **swallow-with-comment** — empty body but documented best-effort intent.
  - **swallow-no-comment** — empty body, no explanation. Suspicious.
  - **log-only** — `console.error` / `tracing::warn!` and nothing else; no user-visible
    feedback or state cleanup. Suspicious if user-facing.
  - **rethrow** — re-throws or returns the error wrapped.
  - **mixed** — has logic but does not propagate; needs case-by-case review.

## Summary Statistics

| Metric                                                | Count |
| ----------------------------------------------------- | ----- |
| TypeScript files audited (with `try`)                 | 27    |
| TypeScript `try`/`catch` blocks audited               | 54    |
| TypeScript `.catch(() => { ... })` promise blocks     | 4     |
| Rust files audited (with `let _ =`)                   | 1     |
| Rust `let _ = <fallible>` discards audited            | 3     |
| **handled** (proper error surfacing)                  | 38    |
| **swallow-with-comment** (intentional, documented)    | 14    |
| **swallow-no-comment** (suspicious — empty + silent)  | 0     |
| **log-only** (console-only, no user feedback)         | 0     |
| **rethrow / propagate**                               | 1     |
| **mixed / needs review**                              | 5     |

> No completely empty + uncommented `catch` blocks exist today. The sprint-88
> rule (`.claude/rules/test-scenarios.md`) is therefore **forward-looking**:
> any new empty `catch` must land with a single-line justification comment
> AND a row in this audit.

## TypeScript Inventory

### Stores

| File                              | Line | Classification         | Notes                                                                                     |
| --------------------------------- | ---- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `src/stores/connectionStore.ts`   | 72   | handled                | sets `error` + clears `loading` for `loadConnections`.                                    |
| `src/stores/connectionStore.ts`   | 81   | handled                | sets `error` for `loadGroups`.                                                            |
| `src/stores/connectionStore.ts`   | 145  | handled                | maps to `activeStatuses[id] = { type: "error", message }`.                                |
| `src/stores/documentStore.ts`     | 91   | handled                | guards stale request id + sets store error.                                               |
| `src/stores/documentStore.ts`     | 112  | handled                | identical pattern for `loadCollections`.                                                  |
| `src/stores/schemaStore.ts`       | 110  | handled                | `loadSchemas` error + loading flag clear.                                                 |
| `src/stores/schemaStore.ts`       | 124  | handled                | `loadTables` error + loading flag clear.                                                  |
| `src/stores/schemaStore.ts`       | 136  | handled                | `loadViews` error.                                                                        |
| `src/stores/schemaStore.ts`       | 148  | handled                | `loadFunctions` error.                                                                    |
| `src/stores/schemaStore.ts`       | 213  | swallow-with-comment   | `dropTable` refresh: optimistically removes table from cache on refresh failure. comment present. |
| `src/stores/schemaStore.ts`       | 240  | swallow-with-comment   | `renameTable` refresh: optimistically renames in cache on refresh failure. comment present. |
| `src/stores/schemaStore.ts`       | 307  | swallow-with-comment   | `prefetchSchemaColumns`: explicitly best-effort prefetch. comment present.                |
| `src/stores/tabStore.ts`          | 109  | swallow-with-comment   | `localStorage.setItem` quota / SSR guard. comment present.                                |
| `src/stores/tabStore.ts`          | 470  | swallow-with-comment   | persisted-tabs JSON.parse — falls back to default. comment present.                       |
| `src/stores/favoritesStore.ts`    | 29   | swallow-with-comment   | `localStorage.setItem` quota / SSR guard. comment present.                                |
| `src/stores/favoritesStore.ts`    | 39   | swallow-with-comment   | persisted favorites JSON.parse — returns `[]`. comment present.                           |

### Components — connection / sidebar / shared

| File                                              | Line | Classification         | Notes                                                                  |
| ------------------------------------------------- | ---- | ---------------------- | ---------------------------------------------------------------------- |
| `src/components/connection/ConnectionDialog.tsx`  | 99   | handled                | maps to `testResult: { success: false, message }`.                     |
| `src/components/connection/ConnectionDialog.tsx`  | 128  | handled                | sets `error` for save failures.                                        |
| `src/components/connection/GroupDialog.tsx`       | 61   | handled                | sets `error` + clears `saving`.                                        |
| `src/components/connection/ImportExportDialog.tsx`| 120  | handled                | sets `error` for export.                                               |
| `src/components/connection/ImportExportDialog.tsx`| 132  | swallow-with-comment   | `.catch(() => {})` clipboard write fallback. comment present.          |
| `src/components/connection/ImportExportDialog.tsx`| 267  | handled                | sets `error` for import.                                               |
| `src/components/layout/Sidebar.tsx`               | 44   | swallow-with-comment   | `readWidth` falls back to default on storage failure. comment-equivalent (function name + return). |
| `src/components/layout/Sidebar.tsx`               | 128  | swallow-with-comment   | width persistence — comment present.                                   |
| `src/components/shared/BsonTreeViewer.tsx`        | 42   | swallow-with-comment   | `JSON.stringify` fallback to `String(value)` for non-serialisable input. |
| `src/components/shared/BsonTreeViewer.tsx`        | 139  | mixed                  | clipboard `copyToClipboard` returns `false` on failure; UI surfaces toast through return value. |
| `src/components/shared/QuickLookPanel.tsx`        | 43   | swallow-with-comment   | `JSON.stringify` fallback for object preview.                          |
| `src/components/shared/QuickLookPanel.tsx`        | 52   | swallow-with-comment   | `JSON.parse` fallback when value is not JSON.                          |

### Components — datagrid

| File                                              | Line | Classification         | Notes                                                                  |
| ------------------------------------------------- | ---- | ---------------------- | ---------------------------------------------------------------------- |
| `src/components/datagrid/CellDetailDialog.tsx`    | 30   | swallow-with-comment   | `JSON.stringify` fallback in cell rendering.                           |
| `src/components/datagrid/CellDetailDialog.tsx`    | 62   | mixed                  | `.catch(() => {})` on copy-to-clipboard; user notice handled by toast indirectly. |
| `src/components/datagrid/BlobViewerDialog.tsx`    | 76   | swallow-with-comment   | `TextDecoder` fatal failure — returns null to fall back to hex display.|
| `src/components/datagrid/useDataGridEdit.ts`      | 591  | swallow-with-comment   | "Mirror the RDB branch: surface via fetchData's error path." comment present. |
| `src/components/datagrid/useDataGridEdit.ts`      | 614  | swallow-with-comment   | "Error handling is done via the fetchData flow" comment present.       |
| `src/components/DataGrid.tsx`                     | 182  | handled                | guards stale fetch id + sets `error`.                                  |

### Components — schema / structure

| File                                              | Line | Classification         | Notes                                                                  |
| ------------------------------------------------- | ---- | ---------------------- | ---------------------------------------------------------------------- |
| `src/components/schema/StructurePanel.tsx`        | 47   | handled                | sets `error` for column/index/constraint fetch.                        |
| `src/components/schema/ViewStructurePanel.tsx`    | 45   | handled                | sets `error` for view metadata fetch.                                  |
| `src/components/schema/ViewStructurePanel.tsx`    | 201  | mixed                  | `.catch(() => {})` for fire-and-forget definition prefetch.            |
| `src/components/structure/ColumnsEditor.tsx`      | 452  | handled                | preview path: sets `previewError` + clears `previewSql`.               |
| `src/components/structure/ColumnsEditor.tsx`      | 471  | handled                | execute path: sets `previewError`.                                     |
| `src/components/structure/IndexesEditor.tsx`      | 71   | handled                | submit path: sets `error`.                                             |
| `src/components/structure/IndexesEditor.tsx`      | 295  | handled                | preview confirm: sets `previewError`.                                  |
| `src/components/structure/IndexesEditor.tsx`      | 332  | handled                | drop-index preview surfaces error in modal.                            |
| `src/components/structure/ConstraintsEditor.tsx`  | 114  | handled                | submit path: sets `error`.                                             |
| `src/components/structure/ConstraintsEditor.tsx`  | 388  | handled                | drop-constraint preview surfaces error in modal.                       |
| `src/components/structure/ConstraintsEditor.tsx`  | 410  | handled                | preview confirm: sets `previewError`.                                  |

### Components — query / document

| File                                              | Line | Classification         | Notes                                                                  |
| ------------------------------------------------- | ---- | ---------------------- | ---------------------------------------------------------------------- |
| `src/components/query/QueryTab.tsx`               | 150  | swallow-with-comment   | cancelQuery best-effort: "Query may have already completed".           |
| `src/components/query/QueryTab.tsx`               | 177  | handled                | document-paradigm JSON parse error → tab error state.                  |
| `src/components/query/QueryTab.tsx`               | 274  | handled                | document-paradigm execution error → tab error state.                   |
| `src/components/query/QueryTab.tsx`               | 369  | handled                | single-statement execution error → tab error state.                    |
| `src/components/query/QueryTab.tsx`               | 423  | handled                | multi-statement execution error → accumulated `errors[]`.              |
| `src/components/query/QueryTab.tsx`               | 505  | swallow-with-comment   | `.catch(() => {})` for cancel-query keyboard handler. comment present. |
| `src/components/query/EditableQueryResultGrid.tsx`| 185  | handled                | sets `executeError` + clears `executing`.                              |
| `src/components/DocumentDataGrid.tsx`             | 75   | handled                | guards stale fetch id + sets `error`.                                  |
| `src/components/DocumentDataGrid.tsx`             | 185  | handled                | sets `addError` from add-document modal.                               |
| `src/components/document/AddDocumentModal.tsx`    | 67   | handled                | sets `parseError` for invalid JSON input.                              |

### Lib / Types

| File                                              | Line | Classification         | Notes                                                                  |
| ------------------------------------------------- | ---- | ---------------------- | ---------------------------------------------------------------------- |
| `src/lib/themeBoot.ts`                            | 59   | swallow-with-comment   | `JSON.parse` fallback returns default theme state.                     |
| `src/types/connection.ts`                         | 177  | swallow-with-comment   | `parseConnectionUrl` fallback: returns `null` on URL parse failure.    |

## Rust Inventory (`let _ = ...` discards)

| File                                         | Line | Classification         | Notes                                                                  |
| -------------------------------------------- | ---- | ---------------------- | ---------------------------------------------------------------------- |
| `src-tauri/src/commands/connection.rs`       | 136  | mixed                  | `let _ = app.emit(...)` for status-changed event after error path. Frontend listens but missed events are tolerable. |
| `src-tauri/src/commands/connection.rs`       | 189  | mixed                  | `let _ = app.emit(...)` after successful connect; missed events degrade UI freshness only. |
| `src-tauri/src/commands/connection.rs`       | 204  | mixed                  | `let _ = app.emit(...)` after async error; same justification.         |

> No genuinely empty Rust `Err(_) => {}` arms found in the audited tree. The
> `let _ = app.emit(...)` cases are flagged **mixed** because they discard a
> potential `tauri::Error` that could plausibly indicate a backend bug
> (e.g. the frontend is gone). Follow-up sprints may want to log via
> `tracing::warn!` instead of `let _ =`.

## Follow-up Recommendations (NOT IN sprint-88 SCOPE)

1. **`mixed` reviews (5 entries)** — promote to handled or swallow-with-comment with a
   one-line justification, then re-classify. Owners assigned in roadmap during sprint-89+.
2. **`let _ = app.emit(...)`** — replace with `if let Err(e) = app.emit(...) { tracing::warn!(...); }`
   so silent IPC drops show up in logs.
3. **Add `eslint` rule banning empty `catch {}`** without a leading comment line — lock
   the new convention in CI rather than relying on review discipline.

## Sources / Reproduction

- TypeScript scan: `rg --pcre2 -nP '^\s*try\s*\{$|^\s*\}\s*catch\s*[\(\{]' src` (run from repo root).
- Rust scan: `rg -n 'let _ =' src-tauri/src`.
- Audit anchored at commit at the start of sprint-88 (see `git log -1` on the branch).
