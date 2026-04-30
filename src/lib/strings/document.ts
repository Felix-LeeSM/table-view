/**
 * Document-paradigm UI string constants.
 *
 * Strings live in a dedicated module (rather than inline JSX) so they remain
 * easy to swap into an i18n catalog later without touching component layout
 * or tests. Re-export the constant from any document component that renders it.
 */

import { PARADIGM_VOCABULARY } from "./paradigm-vocabulary";

/**
 * Banner copy shown above MongoDB collection grids.
 *
 * Sprint 87 already shipped cell-level editing + Add Document for collections,
 * so the original Sprint 101 spec text ("Read-only — editing not yet supported")
 * is no longer accurate. The current scope gap is schema/DDL operations
 * (create collection, drop, indexes, validators), so the banner reflects that.
 */
export const COLLECTION_READONLY_BANNER_TEXT =
  "Beta — schema and DDL operations are not yet supported.";

/**
 * Document-paradigm wording overrides for the shared `DataGridToolbar`.
 *
 * Sprint 118 (#PAR-2) — `DataGridToolbar` is mounted by both the RDB grid
 * (`DataGrid`) and the document grid (`DocumentDataGrid`). The toolbar's
 * default props keep RDB wording (`"rows"`, `"Add row"`, …) so existing
 * RDB tests stay green; document callers spread `DOCUMENT_LABELS` to swap
 * the user-visible strings without touching paradigm-coupling code in the
 * toolbar itself.
 *
 * Sprint 179 — the constant is now derived from `PARADIGM_VOCABULARY` so
 * the dictionary is the single source of truth. The literal output strings
 * are preserved exactly (lower-cased `"documents"` for the inline count
 * label, sentence-case `"Add document"` / `"Delete document"` /
 * `"Duplicate document"` for the action buttons) — the dictionary's
 * `document` entry uses the title-case schema vocabulary
 * (`"Documents"`, `"Add Field"`), which is intentionally distinct from the
 * toolbar action copy. Hand-rolling these four strings here (rather than
 * reusing the dictionary's `addUnit` / `records` directly) keeps the
 * existing RDB-vs-document toolbar tone parity intact.
 */
const docVocab = PARADIGM_VOCABULARY.document;
export const DOCUMENT_LABELS = {
  rowCountLabel: docVocab.records.toLowerCase(),
  addRowLabel: `Add ${docVocab.record.toLowerCase()}`,
  deleteRowLabel: `Delete ${docVocab.record.toLowerCase()}`,
  duplicateRowLabel: `Duplicate ${docVocab.record.toLowerCase()}`,
} as const;
