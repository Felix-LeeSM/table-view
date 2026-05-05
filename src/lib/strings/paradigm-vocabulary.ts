/**
 * Paradigm-aware UI vocabulary dictionary — the single source of truth
 * for user-visible nouns on the structure / data surfaces. Each
 * `Paradigm` maps to a `ParadigmVocabulary` covering:
 *
 * - `unit` / `units`: the smallest schema element (Column / Field).
 * - `record` / `records`: one data row (Row / Document / Entry).
 * - `container`: the parent (Table / Collection / Index / Namespace).
 * - `addUnit`: imperative button copy ("Add Column" / "Add Field").
 * - `emptyUnits`: empty-state copy ("No columns found").
 *
 * The `rdb` entry MUST equal the legacy English copy already shipped in
 * the touched components — existing tests assert those literals.
 *
 * The `document` entry must match `DOCUMENT_LABELS` in `document.ts` so
 * toolbar consumers' literal output stays stable. `document.ts` lowers
 * the case for the toolbar variants.
 *
 * `search` / `kv` are best-effort — no surface mounts them yet, but the
 * dictionary owns full paradigm coverage by contract.
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
 * Resolve a paradigm to its vocabulary entry, defaulting to `rdb` when
 * `paradigm` is `undefined`. Centralised so consumers don't have to
 * ternary at every label boundary; components that omit the prop see
 * RDB copy (matches the historical hard-coded literals).
 */
export function getParadigmVocabulary(paradigm?: Paradigm): ParadigmVocabulary {
  return PARADIGM_VOCABULARY[paradigm ?? "rdb"];
}
