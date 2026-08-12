import type {
  SchemaGraphDiffChangeKind,
  SchemaGraphDiffSummary,
} from "@/lib/schemaGraphDiff";

/**
 * Schema diff -> ERD canvas highlight (ADR 0054 decision 6). Pure lookup tables:
 * the canvas joins them by node id, so marking a card costs no layout input and
 * cannot move a node the user dragged.
 *
 * `SchemaGraphDiffEntry.tableIds` already holds ERD node ids, and a column
 * entry's `id` is the column node id (`schemaGraphColumnId`), so neither side
 * needs a translation step.
 *
 * The canvas draws the diff's *after* snapshot. An entry that names only tables
 * missing from it — a dropped table, or a column of one — therefore reaches no
 * card and stays a `SchemaGraphDiffPanel` row.
 */

/** Render order, so a card carrying several kinds always lists them alike. */
export const ERD_DIFF_CHANGE_KINDS: readonly SchemaGraphDiffChangeKind[] = [
  "added",
  "removed",
  "changed",
];

export interface ErdDiffHighlight {
  /** Table node id -> every change kind whose entry named it in `tableIds`. */
  readonly tables: ReadonlyMap<string, ReadonlySet<SchemaGraphDiffChangeKind>>;
  /**
   * Table node id -> the kind of the diff entry for the table *itself*
   * (`entityKind === "table"`). `tables` cannot tell a brand-new table from a
   * surviving one that merely gained a column — both carry `added` there — so
   * the card outline reads this map instead.
   */
  readonly tableSelfKinds: ReadonlyMap<string, SchemaGraphDiffChangeKind>;
  /** Column node id -> its kind. A column sits in exactly one of the three. */
  readonly columns: ReadonlyMap<string, SchemaGraphDiffChangeKind>;
}

export const EMPTY_ERD_DIFF_HIGHLIGHT: ErdDiffHighlight = {
  tables: new Map(),
  tableSelfKinds: new Map(),
  columns: new Map(),
};

export function buildErdDiffHighlight(
  diff: SchemaGraphDiffSummary | null | undefined,
): ErdDiffHighlight {
  if (!diff) return EMPTY_ERD_DIFF_HIGHLIGHT;

  const tables = new Map<string, Set<SchemaGraphDiffChangeKind>>();
  const tableSelfKinds = new Map<string, SchemaGraphDiffChangeKind>();
  const columns = new Map<string, SchemaGraphDiffChangeKind>();

  for (const group of Object.values(diff.groups)) {
    for (const kind of ERD_DIFF_CHANGE_KINDS) {
      for (const entry of group[kind]) {
        if (entry.entityKind === "column") columns.set(entry.id, kind);
        // A table entry's `id` is the table node id, and `selectSchemaGraphDiff`
        // puts a table in at most one of added/removed/changed.
        if (entry.entityKind === "table") tableSelfKinds.set(entry.id, kind);
        // `tableIds` is optional. An entry without it highlights nothing —
        // never every card, which would read as "the whole schema changed".
        for (const tableId of entry.tableIds ?? []) {
          const kinds = tables.get(tableId) ?? new Set();
          kinds.add(kind);
          tables.set(tableId, kinds);
        }
      }
    }
  }

  return { tables, tableSelfKinds, columns };
}

/** Kinds on one table node, in {@link ERD_DIFF_CHANGE_KINDS} order. */
export function erdDiffTableKinds(
  highlight: ErdDiffHighlight,
  tableId: string,
): readonly SchemaGraphDiffChangeKind[] {
  const kinds = highlight.tables.get(tableId);
  if (!kinds) return [];
  return ERD_DIFF_CHANGE_KINDS.filter((kind) => kinds.has(kind));
}
