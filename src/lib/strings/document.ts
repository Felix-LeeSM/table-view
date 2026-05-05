/**
 * Document-paradigm UI string constants.
 *
 * Strings live in a dedicated module (rather than inline JSX) so they remain
 * easy to swap into an i18n catalog later without touching component layout
 * or tests. Re-export the constant from any document component that renders it.
 */

import { PARADIGM_VOCABULARY } from "./paradigm-vocabulary";

/**
 * Banner copy shown above MongoDB collection grids. Cell-level editing
 * and Add Document already ship; the remaining gap is schema/DDL ops
 * (create collection, drop, indexes, validators) — the banner reflects
 * that.
 */
export const COLLECTION_READONLY_BANNER_TEXT =
  "Beta — schema and DDL operations are not yet supported.";

/**
 * Document-paradigm wording overrides for the shared `DataGridToolbar`.
 * Document callers spread `DOCUMENT_LABELS` to swap user-visible
 * strings; the toolbar itself stays paradigm-agnostic.
 *
 * Derived from `PARADIGM_VOCABULARY` so the dictionary is the single
 * source of truth, but the toolbar copy uses lowercase `"documents"` /
 * sentence-case `"Add document"` rather than the title-case
 * (`"Documents"`, `"Add Field"`) the dictionary reserves for the
 * schema tree. The two registers are intentionally distinct.
 */
const docVocab = PARADIGM_VOCABULARY.document;
export const DOCUMENT_LABELS = {
  rowCountLabel: docVocab.records.toLowerCase(),
  addRowLabel: `Add ${docVocab.record.toLowerCase()}`,
  deleteRowLabel: `Delete ${docVocab.record.toLowerCase()}`,
  duplicateRowLabel: `Duplicate ${docVocab.record.toLowerCase()}`,
} as const;
