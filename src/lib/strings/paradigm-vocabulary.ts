/**
 * Paradigm-aware UI vocabulary dictionary.
 *
 * Sprint 179 — single source of truth for the user-visible nouns the
 * structure-and-fields surfaces show. Each `Paradigm` (`rdb`, `document`,
 * `search`, `kv`) maps to a `ParadigmVocabulary` entry covering the
 * load-bearing axes:
 *
 * - `unit` / `units`: the smallest schema element (Column / Field).
 * - `record` / `records`: a single row of data (Row / Document / Entry).
 * - `container`: the parent schema object (Table / Collection / Index /
 *   Keyspace).
 * - `addUnit`: the imperative button copy ("Add Column" / "Add Field").
 * - `emptyUnits`: the empty-state copy ("No columns found" / "No fields
 *   found").
 *
 * The `rdb` entry MUST equal the legacy English copy that already ships in
 * the touched components ("Column", "Add Column", "No columns found"); the
 * existing tests assert those literals and the dictionary is the new
 * compile-time anchor.
 *
 * The `document` entry MUST match the user-facing `DOCUMENT_LABELS`
 * derivation in `document.ts` so the toolbar consumers' literal output
 * (`"documents"`, `"Add document"`, …) does not change shape — see
 * `document.ts` for the lower-cased toolbar variants.
 *
 * Sprint 179 keeps `search` / `kv` as best-effort entries: they aren't
 * mounted by any structure surface today, but the dictionary owns full
 * paradigm coverage so AC-179-01 can verify it.
 */
import type { Paradigm } from "@/types/connection";

export interface ParadigmVocabulary {
  /** Singular schema element ("Column" / "Field"). */
  unit: string;
  /** Plural schema element ("Columns" / "Fields") — used for tab labels. */
  units: string;
  /** Singular data record ("Row" / "Document" / "Entry"). */
  record: string;
  /** Plural data record ("Rows" / "Documents" / "Entries"). */
  records: string;
  /** Container holding records ("Table" / "Collection" / "Index" / "Keyspace"). */
  container: string;
  /** Imperative button copy for adding a unit ("Add Column" / "Add Field"). */
  addUnit: string;
  /** Empty-state copy when the unit list is empty ("No columns found"). */
  emptyUnits: string;
}

/**
 * Single-source-of-truth dictionary keyed by `Paradigm`.
 *
 * The dictionary type `Record<Paradigm, ParadigmVocabulary>` makes it a
 * compile-error to add a new `Paradigm` variant without filling in the
 * vocabulary — Strict TS is the fence here.
 */
export const PARADIGM_VOCABULARY: Record<Paradigm, ParadigmVocabulary> = {
  rdb: {
    unit: "Column",
    units: "Columns",
    record: "Row",
    records: "Rows",
    container: "Table",
    addUnit: "Add Column",
    emptyUnits: "No columns found",
  },
  document: {
    unit: "Field",
    units: "Fields",
    record: "Document",
    records: "Documents",
    container: "Collection",
    addUnit: "Add Field",
    emptyUnits: "No fields found",
  },
  search: {
    unit: "Field",
    units: "Fields",
    record: "Document",
    records: "Documents",
    container: "Index",
    addUnit: "Add Field",
    emptyUnits: "No fields found",
  },
  kv: {
    unit: "Field",
    units: "Fields",
    record: "Entry",
    records: "Entries",
    container: "Namespace",
    addUnit: "Add Field",
    emptyUnits: "No entries found",
  },
};

/**
 * Resolve a paradigm to its vocabulary entry, falling back to `rdb` when
 * the input is `undefined`.
 *
 * Sprint 179 (AC-179-04) — the fallback rule lives in exactly one place
 * (this getter) so consumer call sites don't need to ternary at every
 * label boundary. Components that omit the prop see RDB vocabulary, which
 * matches the historical behavior of the touched files (they hardcoded
 * RDB literals before this sprint).
 */
export function getParadigmVocabulary(paradigm?: Paradigm): ParadigmVocabulary {
  return PARADIGM_VOCABULARY[paradigm ?? "rdb"];
}
