/**
 * Document-paradigm UI string constants.
 *
 * Strings live in a dedicated module (rather than inline JSX) so they remain
 * easy to swap into an i18n catalog later without touching component layout
 * or tests. Re-export the constant from any document component that renders it.
 */

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
