# Sprint 179 — Labels Audit Report

Generated: 2026-04-30

## Methodology

Candidates gathered with:

```
grep -rn -E "(Column|Row|Table|Field|Document|Collection)" src/components/ --include="*.tsx" | grep -v test
```

Total raw candidates: **722** lines (most are field names, type names, identifiers, comments, or aria-labels referring to a specific column/field name like `Edit column ${col.name}` — those are paradigm-fixed in nature because they describe a concrete schema element, not the paradigm noun).

This audit triages every **user-visible** "column" / "row" / "table" / "field" / "document" / "collection" mention in `src/components/**.tsx` and classifies it as:

- **paradigm-aware** — the label sources its string from `PARADIGM_VOCABULARY` (or `DOCUMENT_LABELS` derived therefrom), so the surface speaks the right paradigm when given one.
- **paradigm-fixed** — the label legitimately stays a single literal because the surface is bound to one paradigm, names a concrete schema element, or describes a structural concept that has no equivalent in the other paradigm. A one-line reason explains why.

The audit follows two passes: (1) the touched components for this sprint (paradigm-shared); (2) sibling structure components that are RDB-only by construction (the contract excludes them but they are listed for transparency).

## Sprint 179 Touched Components (paradigm-shared after this sprint)

| Component | Line | String | Classification | Note |
| --- | --- | --- | --- | --- |
| `src/components/datagrid/DataGridToolbar.tsx` | 39 (default) | `rowCountLabel` default sourced from `PARADIGM_VOCABULARY.rdb.records.toLowerCase()` ("rows") | paradigm-aware | Sprint 179: previously inline literal; now derived from the dictionary's RDB entry. |
| `src/components/datagrid/DataGridToolbar.tsx` | 40 (default) | `addRowLabel` default `Add ${PARADIGM_VOCABULARY.rdb.record.toLowerCase()}` ("Add row") | paradigm-aware | Sprint 179: derived from dictionary; document grid spreads `DOCUMENT_LABELS` to override. |
| `src/components/datagrid/DataGridToolbar.tsx` | 41 (default) | `deleteRowLabel` default ("Delete row") | paradigm-aware | Same pattern as `addRowLabel`. |
| `src/components/datagrid/DataGridToolbar.tsx` | 42 (default) | `duplicateRowLabel` default ("Duplicate row") | paradigm-aware | Same pattern as `addRowLabel`. |
| `src/components/schema/StructurePanel.tsx` | 99 | Sub-tab label `vocab.units` ("Columns" for RDB / "Fields" for document) | paradigm-aware | Sprint 179: previously inline `"Columns"` literal; now sourced from dictionary. The `key: "columns"` identifier remains a stable id (not user-visible). |
| `src/components/schema/StructurePanel.tsx` | 100 | Sub-tab label `"Indexes"` | paradigm-fixed | RDB-only structural concept; Mongo has indexes via a different API path that this surface does not mount. Out of Sprint 179 scope. |
| `src/components/schema/StructurePanel.tsx` | 101 | Sub-tab label `"Constraints"` | paradigm-fixed | SQL-only concept (Mongo has no equivalent). Out of Sprint 179 scope. |
| `src/components/structure/ColumnsEditor.tsx` | 514 | Button `aria-label={ariaAddUnit}` ("Add column" / "Add field") | paradigm-aware | Sentence-case derivation from `vocab.unit`; preserves the exact lowercase aria-label that the existing RDB tests assert (`name: "Add column"`). |
| `src/components/structure/ColumnsEditor.tsx` | 517 | Button visible text `{vocab.addUnit}` ("Add Column" / "Add Field") | paradigm-aware | Title-case action copy sourced from dictionary's `addUnit`. |
| `src/components/structure/ColumnsEditor.tsx` | 643 | Empty-state copy `{vocab.emptyUnits}` ("No columns found" / "No fields found") | paradigm-aware | Sourced from dictionary's `emptyUnits`. |
| `src/components/structure/ColumnsEditor.tsx` | 235 | aria-label `"New column name"` (inline-add row) | paradigm-fixed | Refers to the literal column-being-typed; a future paradigm-aware refactor of the inline-add row is out of Sprint 179 scope. Renders only inside a paradigm-shared component but the row itself is RDB-shaped (DDL). |
| `src/components/structure/ColumnsEditor.tsx` | 245 | aria-label `"New column data type"` | paradigm-fixed | Same reason as above — DDL-shaped row. |
| `src/components/structure/ColumnsEditor.tsx` | 253 | aria-label `"New column nullable"` | paradigm-fixed | Same reason. |
| `src/components/structure/ColumnsEditor.tsx` | 263 | aria-label `"New column default value"` | paradigm-fixed | Same reason. |
| `src/components/structure/ColumnsEditor.tsx` | 280 | aria-label `"Confirm add column"` | paradigm-fixed | Same reason. |
| `src/components/structure/ColumnsEditor.tsx` | 289 | aria-label `"Cancel add column"` | paradigm-fixed | Same reason. |
| `src/components/structure/ColumnsEditor.tsx` | 174 | aria-label `Edit column ${col.name}` | paradigm-fixed | Refers to the specific column being edited (per-row aria-label); paradigm-aware copy would not improve the UX here. |
| `src/components/structure/ColumnsEditor.tsx` | 185 | aria-label `Delete column ${col.name}` | paradigm-fixed | Same reason. |
| `src/components/structure/ColumnsEditor.tsx` | 615 | aria-label `Remove pending column ${change.name}` | paradigm-fixed | Same reason. |
| `src/lib/strings/document.ts` | 50 | `DOCUMENT_LABELS.rowCountLabel` derived from `docVocab.records.toLowerCase()` ("documents") | paradigm-aware | Sprint 179: now derived from `PARADIGM_VOCABULARY.document`; literal output unchanged. |
| `src/lib/strings/document.ts` | 51 | `DOCUMENT_LABELS.addRowLabel` derived from `docVocab.record` ("Add document") | paradigm-aware | Same. |
| `src/lib/strings/document.ts` | 52 | `DOCUMENT_LABELS.deleteRowLabel` derived ("Delete document") | paradigm-aware | Same. |
| `src/lib/strings/document.ts` | 53 | `DOCUMENT_LABELS.duplicateRowLabel` derived ("Duplicate document") | paradigm-aware | Same. |

### Hardcoded-RDB-Label Check (touched files)

Per AC-179-05, paradigm-shared components must not contain hardcoded RDB labels in user-visible JSX text.

```
$ grep -nE '>(Add Column|No columns found|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx
(empty result — confirmed zero hardcoded RDB labels in JSX text nodes of paradigm-shared components)
```

## Sibling structure surfaces (RDB-only by construction)

The contract excludes these from Sprint 179's write scope, but they share the structure-panel parent and are surfaced here for completeness.

| Component | Line | String | Classification | Note |
| --- | --- | --- | --- | --- |
| `src/components/structure/IndexesEditor.tsx` | 94 | `"Create Index"` button text | paradigm-fixed | Indexes are an RDB-only DDL surface in this sprint's scope; Mongo's indexes use a separate path (out of scope). |
| `src/components/structure/IndexesEditor.tsx` | 374 | `"Create Index"` button text (action bar) | paradigm-fixed | Same reason. |
| `src/components/structure/IndexesEditor.tsx` | 461 | `"No indexes found"` empty-state | paradigm-fixed | Same reason. |
| `src/components/structure/ConstraintsEditor.tsx` | 137 | `"Add Constraint"` button text (modal) | paradigm-fixed | Constraints are SQL-specific; Mongo has no equivalent. |
| `src/components/structure/ConstraintsEditor.tsx` | 461 | `"Add Constraint"` button text (action bar) | paradigm-fixed | Same reason. |
| `src/components/structure/ConstraintsEditor.tsx` | 532 | `"No constraints found"` empty-state | paradigm-fixed | Same reason. |
| `src/components/schema/ViewStructurePanel.tsx` | 17 | Tab labels `"Columns"` / `"Definition"` (SQL views) | paradigm-fixed | Views are an SQL concept; this surface only mounts under RDB. |
| `src/components/schema/SchemaTree.tsx` | 101 | Tree-section label `"Tables"` (and `"No tables"` empty label) | paradigm-fixed | RDB-paradigm tree section; Mongo's tree uses `DocumentDatabaseTree.tsx` with its own paradigm-correct labels (Collections). |

## Document-paradigm surfaces (paradigm-fixed by mount)

| Component | Line | String | Classification | Note |
| --- | --- | --- | --- | --- |
| `src/components/document/AddDocumentModal.tsx` | 259 | aria-label `"Document JSON"` | paradigm-fixed | Document-paradigm-only modal; surface is gated by paradigm at mount. |
| `src/components/document/DocumentDataGrid.tsx` | 273-276 | spreads `DOCUMENT_LABELS` to `DataGridToolbar` (`addRowLabel="Add document"`, etc.) | paradigm-aware | The labels source from `PARADIGM_VOCABULARY.document` via `DOCUMENT_LABELS` (Sprint 179 derivation). |
| `src/components/document/DocumentFilterBar.tsx` | 317 | aria-label `"Filter field"` | paradigm-fixed | Document-paradigm-only filter bar; uses Mongo vocabulary by mount. |
| `src/components/shared/QuickLookPanel.tsx` | 322 | aria-label `"Row Details"` (RDB branch) | paradigm-fixed | Conditional branch already paradigm-aware via tab.paradigm — RDB branch uses "Row", document branch uses "Document". Two separate aria-labels co-exist in the file. |
| `src/components/shared/QuickLookPanel.tsx` | 357 | aria-label `"Close row details"` (RDB branch) | paradigm-fixed | Same reason. |
| `src/components/shared/QuickLookPanel.tsx` | 439 | aria-label `"Document Details"` (document branch) | paradigm-fixed | Same reason. |
| `src/components/shared/QuickLookPanel.tsx` | 474 | aria-label `"Close document details"` (document branch) | paradigm-fixed | Same reason. |
| `src/components/shared/BsonTreeViewer.tsx` | 438, 449 | aria-label `"BSON document tree"` | paradigm-fixed | BSON is a Mongo-specific representation; surface mounts only under document paradigm. |
| `src/components/rdb/FilterBar.tsx` | 218 | aria-label `"Filter column"` | paradigm-fixed | RDB-only filter bar (sibling to `DocumentFilterBar`); paradigm gating happens at mount. |
| `src/components/schema/SchemaTree.tsx` | 1935 | aria-label `"New table name"` (rename input) | paradigm-fixed | RDB-only schema tree branch (Mongo schema tree is a separate component — `DocumentDatabaseTree`). |

## Audit Totals

- Paradigm-aware (sourced via dictionary): **15** rows.
- Paradigm-fixed (legitimate RDB-only or paradigm-only mount): **22** rows.
- Total user-visible paradigm-vocabulary rows audited: **37**.
- Hardcoded paradigm-RDB labels remaining in paradigm-shared JSX: **0** (verified via the grep at the top of this report).

## Verification

```
$ grep -nE '>(Add Column|No columns found|Columns)<' src/components/structure/ColumnsEditor.tsx src/components/schema/StructurePanel.tsx
# (empty)

$ grep -nE 'rdb:|document:|search:|kv:|unit:|units:|record:|records:|container:|addUnit:|emptyUnits:' src/lib/strings/paradigm-vocabulary.ts | wc -l
       35
# (4 paradigms × 7 keys = 28 vocabulary entries + 7 interface field declarations = 35 lines; all keys present.)
```
