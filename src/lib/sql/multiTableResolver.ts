/**
 * Multi-table result-column resolver (issue #1298, multi-table edit step 2).
 *
 * Given a parsed SELECT AST (`SqlSelectStatement` from `sqlAst.ts`, produced
 * by the sql-parser-core WASM via `parseSqlPreloaded`), the actual result
 * column-name sequence, and a schema-metadata lookup, this pure module
 * attributes each result column back to a *source table instance* + source
 * column — or marks it unattributable.
 *
 * Design (decisions locked in the issue):
 *  - Attribution logic lives in TS (schema meta lives in `schemaStore`); the
 *    WASM boundary is only crossed for parsing, upstream of this module.
 *  - **Positional mapping + name self-verification.** We predict the result
 *    column-name sequence from the AST projection (expanding `*`), then match
 *    it position-by-position against the real result names. A single mismatch
 *    (stale schema cache, unexpected shape) downgrades the WHOLE result to
 *    unattributable — silent mis-mapping is removed structurally, not merely
 *    made unlikely. Same-named columns are fine: position pins identity.
 *  - Table "instances" not tables: `users u1 JOIN users u2` is two instances,
 *    keyed by their zero-based FROM position.
 *
 * Out of scope (the whole result becomes unattributable): aggregates /
 * GROUP BY / HAVING / set-operations / FROM subqueries (derived tables).
 *
 * Upstream parser gating (verified against sql-parser-core): qualified star
 * (`SELECT u.*`) and `DISTINCT` are rejected at *parse* time with a
 * `SqlParseError`, so they never reach this resolver — the caller treats a
 * parse error as read-only. Column-level aliases (`SELECT id AS foo`) parse
 * since issue #1297 (`SelectListItem::Column` carries `alias`); issue #1299
 * makes this resolver alias-aware — a slot's predicted name is `alias ??
 * reference.column`, so an aliased projection matches its DB-assigned result
 * name while attribution still points at the *source* column. Positional +
 * name self-verification is unchanged, so silent mis-mapping stays impossible.
 */

import type {
  SqlColumnRef,
  SqlFromItem,
  SqlSelectListItem,
  SqlSelectStatement,
} from "./sqlAst";

/**
 * The subset of `ColumnInfo` this module needs. `@/types/schema`'s
 * `ColumnInfo` is structurally assignable (it has both fields), so the
 * real caller can pass `tableColumnsCache` entries with no mapping.
 */
export interface ResolverColumn {
  name: string;
  is_primary_key: boolean;
}

/**
 * Schema-metadata source. Returns the ordered column list for a
 * `(schema, table)` pair, or `null` when the metadata is not cached.
 * `schema` is `null` for unqualified table references — the lookup owns
 * default-schema resolution if it needs one.
 */
export type SchemaColumnLookup = (
  schema: string | null,
  table: string,
) => readonly ResolverColumn[] | null;

/** One source table occurrence in the FROM clause. */
export interface TableInstance {
  /** Zero-based position in the FROM list — the stable instance identity. */
  index: number;
  schema: string | null;
  table: string;
  /** Written alias, or `null`. */
  alias: string | null;
}

export type ColumnAttribution =
  | {
      kind: "attributed";
      /** `TableInstance.index` this column belongs to. */
      instance: number;
      schema: string | null;
      table: string;
      sourceColumn: string;
    }
  | { kind: "unattributable"; reason: string };

/** Per-instance edit-feasibility helper (does the result carry the PK?). */
export interface InstanceEditability {
  instance: number;
  /** True iff the instance has a PK and every PK column is attributed. */
  pkComplete: boolean;
  /** PK column name -> result column index, for attributed PK columns. */
  pkPositions: Record<string, number>;
  /** PK columns absent from the result (empty iff `pkComplete`). */
  missingPk: string[];
}

export interface ResolvedResult {
  instances: TableInstance[];
  /** Positional — aligned 1:1 with the input `resultColumns`. */
  columns: ColumnAttribution[];
  instanceEditability: InstanceEditability[];
}

export const RESOLVE_REASON = {
  aggregateOrGrouped:
    "Result is aggregated / grouped / set-combined — columns can't map to source rows.",
  derivedTable:
    "FROM contains a subquery / derived table — source columns are not resolvable.",
  columnCountMismatch:
    "Predicted column count differs from the result — schema metadata may be stale.",
  nameMismatch:
    "A predicted column name differs from the result — schema metadata may be stale.",
  schemaUnavailable:
    "Schema metadata is unavailable for a source table, so `*` can't be expanded.",
  expression: "Column is an expression / function result, not a source column.",
  ambiguousOrUnknown:
    "Column does not resolve to exactly one source table instance.",
} as const;

/** A projection slot: its attribution + the name we predict for it (if any). */
interface Slot {
  attribution: ColumnAttribution;
  /** `null` for expressions — we can't predict a DB-assigned name. */
  predictedName: string | null;
}

function toInstances(from: readonly SqlFromItem[]): TableInstance[] {
  return from.map((item, index) => ({
    index,
    schema: item.schema,
    table: item.table,
    alias: item.alias,
  }));
}

/** The identifier a qualified ref must use for an instance: alias, else table. */
function refName(inst: TableInstance): string {
  return inst.alias ?? inst.table;
}

/** Attribute a column named `column` living in `inst` (name pre-known). */
function attributeTo(inst: TableInstance, column: string): ColumnAttribution {
  return {
    kind: "attributed",
    instance: inst.index,
    schema: inst.schema,
    table: inst.table,
    sourceColumn: column,
  };
}

function unattributable(reason: string): ColumnAttribution {
  return { kind: "unattributable", reason };
}

/**
 * Resolve a bare (unqualified) column name to a single instance.
 *  - One instance total: unambiguous by construction, no schema needed.
 *  - Multiple instances: require schema meta and a unique owning table.
 */
function resolveBare(
  column: string,
  instances: TableInstance[],
  instanceColumns: (readonly ResolverColumn[] | null)[],
): ColumnAttribution {
  if (instances.length === 1) return attributeTo(instances[0]!, column);
  const owners = instances.filter((inst) =>
    instanceColumns[inst.index]?.some((c) => c.name === column),
  );
  if (owners.length === 1) return attributeTo(owners[0]!, column);
  return unattributable(RESOLVE_REASON.ambiguousOrUnknown);
}

/** Resolve a qualified ref `q.column` to its instance by alias/table name. */
function resolveQualified(
  ref: SqlColumnRef,
  instances: TableInstance[],
): ColumnAttribution {
  const qualifier = ref.table!;
  const owners = instances.filter((inst) => refName(inst) === qualifier);
  if (owners.length === 1) return attributeTo(owners[0]!, ref.column);
  return unattributable(RESOLVE_REASON.ambiguousOrUnknown);
}

function resolveColumnRef(
  ref: SqlColumnRef,
  instances: TableInstance[],
  instanceColumns: (readonly ResolverColumn[] | null)[],
): ColumnAttribution {
  return ref.table === null
    ? resolveBare(ref.column, instances, instanceColumns)
    : resolveQualified(ref, instances);
}

/**
 * Expand `*` (or a top-level `SELECT *`) into one slot per instance column,
 * in FROM order. Returns `null` if any instance's schema is uncached — the
 * caller then downgrades the whole result (unknown column count).
 */
function expandStar(
  instances: TableInstance[],
  instanceColumns: (readonly ResolverColumn[] | null)[],
): Slot[] | null {
  const slots: Slot[] = [];
  for (const inst of instances) {
    const cols = instanceColumns[inst.index];
    if (!cols) return null;
    for (const col of cols) {
      slots.push({
        attribution: attributeTo(inst, col.name),
        predictedName: col.name,
      });
    }
  }
  return slots;
}

/** Build the positional slot list from the projection, or `null` to downgrade. */
function buildSlots(
  statement: SqlSelectStatement,
  instances: TableInstance[],
  instanceColumns: (readonly ResolverColumn[] | null)[],
): Slot[] | null {
  const columns = statement.columns;
  if (columns.kind === "star") {
    return expandStar(instances, instanceColumns);
  }
  if (columns.kind === "named") {
    return columns.names.map((name) => ({
      attribution: resolveBare(name, instances, instanceColumns),
      predictedName: name,
    }));
  }
  // kind === "expressions"
  const slots: Slot[] = [];
  for (const item of columns.items as SqlSelectListItem[]) {
    if (item.kind === "star") {
      const expanded = expandStar(instances, instanceColumns);
      if (expanded === null) return null;
      slots.push(...expanded);
      continue;
    }
    if (item.kind === "column") {
      slots.push({
        attribution: resolveColumnRef(
          item.reference,
          instances,
          instanceColumns,
        ),
        // Issue #1299 — a projection alias (`SELECT id AS user_id`) becomes the
        // DB-assigned result name, so predict against the alias when present.
        // Attribution still maps to the *source* column, so self-verification
        // stays sound (silent mis-mapping remains structurally impossible).
        predictedName: item.alias ?? item.reference.column,
      });
      continue;
    }
    // expression / function / CASE / subquery — DB-assigned name, unpredictable
    slots.push({
      attribution: unattributable(RESOLVE_REASON.expression),
      predictedName: null,
    });
  }
  return slots;
}

function computeEditability(
  instances: TableInstance[],
  instanceColumns: (readonly ResolverColumn[] | null)[],
  columns: ColumnAttribution[],
): InstanceEditability[] {
  return instances.map((inst) => {
    const pkCols = (instanceColumns[inst.index] ?? [])
      .filter((c) => c.is_primary_key)
      .map((c) => c.name);
    const pkPositions: Record<string, number> = {};
    for (const pk of pkCols) {
      const idx = columns.findIndex(
        (c) =>
          c.kind === "attributed" &&
          c.instance === inst.index &&
          c.sourceColumn === pk,
      );
      if (idx >= 0) pkPositions[pk] = idx;
    }
    const missingPk = pkCols.filter((pk) => !(pk in pkPositions));
    return {
      instance: inst.index,
      pkComplete: pkCols.length > 0 && missingPk.length === 0,
      pkPositions,
      missingPk,
    };
  });
}

function downgradeAll(
  instances: TableInstance[],
  instanceColumns: (readonly ResolverColumn[] | null)[],
  count: number,
  reason: string,
): ResolvedResult {
  const columns = Array.from({ length: count }, () => unattributable(reason));
  return {
    instances,
    columns,
    instanceEditability: computeEditability(
      instances,
      instanceColumns,
      columns,
    ),
  };
}

/**
 * Attribute each result column to its source table instance + column.
 *
 * The returned `columns` array is positional (aligned to `resultColumns`).
 * On any disqualifying condition the entire result is downgraded to
 * unattributable with a shared reason.
 */
export function resolveResultColumns(
  statement: SqlSelectStatement,
  resultColumns: readonly string[],
  lookup: SchemaColumnLookup,
): ResolvedResult {
  const instances = toInstances(statement.from);

  // Exclusions — aggregation / grouping / set-ops / derived tables cannot map
  // a result row back to a source row.
  if (
    statement.group_by.length > 0 ||
    statement.having !== null ||
    statement.set_operation.length > 0
  ) {
    return downgradeAll(
      instances,
      [],
      resultColumns.length,
      RESOLVE_REASON.aggregateOrGrouped,
    );
  }
  if (statement.from.some((item) => item.source.kind === "subquery")) {
    return downgradeAll(
      instances,
      [],
      resultColumns.length,
      RESOLVE_REASON.derivedTable,
    );
  }

  const instanceColumns = instances.map((inst) =>
    lookup(inst.schema, inst.table),
  );

  const slots = buildSlots(statement, instances, instanceColumns);
  if (slots === null) {
    return downgradeAll(
      instances,
      instanceColumns,
      resultColumns.length,
      RESOLVE_REASON.schemaUnavailable,
    );
  }

  // Positional length check — a `*` expansion against a stale cache is the
  // canonical way this desyncs.
  if (slots.length !== resultColumns.length) {
    return downgradeAll(
      instances,
      instanceColumns,
      resultColumns.length,
      RESOLVE_REASON.columnCountMismatch,
    );
  }

  // Name self-verification — one mismatch poisons the whole positional model.
  for (let i = 0; i < slots.length; i++) {
    const predicted = slots[i]!.predictedName;
    if (predicted !== null && predicted !== resultColumns[i]) {
      return downgradeAll(
        instances,
        instanceColumns,
        resultColumns.length,
        RESOLVE_REASON.nameMismatch,
      );
    }
  }

  const columns = slots.map((s) => s.attribution);
  return {
    instances,
    columns,
    instanceEditability: computeEditability(
      instances,
      instanceColumns,
      columns,
    ),
  };
}
