import type { IndexDraft } from "./IndexesTabBody";
import type {
  ForeignKeyDraft,
  CheckDraft,
  UniqueDraft,
} from "./ForeignKeysTabBody";
import type { ColumnDraft } from "./types";
import type {
  ColumnDefinition,
  ConstraintDefinition,
  CreateTablePlanConstraint,
  CreateTablePlanIndex,
  CreateTablePlanRequest,
} from "@/types/schema";

export interface DeclaredConstraint {
  trackingId: string;
  name: string;
  definition: ConstraintDefinition;
}

export interface BuildRequestArgs {
  connectionId: string;
  selectedSchema: string;
  tableName: string;
  tableComment: string;
  columns: ColumnDraft[];
}

/**
 * Base CREATE TABLE request (columns + PK + table_comment). `is_identity` is
 * only attached when true and `table_comment` / `default_value` are `null`
 * when blank so the wire payload stays byte-equivalent to callers with those
 * fields off (backend's `#[serde(default)]` accepts omitted / null / false).
 */
export function buildRequest(previewOnly: boolean, args: BuildRequestArgs) {
  const { connectionId, selectedSchema, tableName, tableComment, columns } =
    args;
  const pkColumns = columns
    .filter((c) => c.is_pk && c.name.trim().length > 0)
    .map((c) => c.name.trim());
  const columnDefs: ColumnDefinition[] = columns
    .filter((c) => c.name.trim().length > 0 && c.data_type.trim().length > 0)
    .map((c) => {
      const trimmedComment = c.comment.trim();
      const def: ColumnDefinition = {
        name: c.name.trim(),
        data_type: c.data_type.trim(),
        nullable: c.nullable,
        default_value: c.default_value.trim() ? c.default_value.trim() : null,
      };
      if (trimmedComment.length > 0) {
        def.comment = trimmedComment;
      }
      if (c.is_identity) {
        def.is_identity = true;
      }
      return def;
    });
  const trimmedTableComment = tableComment.trim();
  return {
    connection_id: connectionId,
    schema: selectedSchema,
    name: tableName.trim(),
    columns: columnDefs,
    primary_key: pkColumns.length > 0 ? pkColumns : null,
    preview_only: previewOnly,
    table_comment: trimmedTableComment.length > 0 ? trimmedTableComment : null,
  };
}

export interface BuildPlanRequestArgs extends BuildRequestArgs {
  database: string;
}

/**
 * Unified plan request. Bundles CREATE TABLE columns + primary key +
 * table_comment + index drafts + constraint drafts so the backend's
 * `create_table_plan` IPC emits the full preview SQL (or executes the chain)
 * in one round trip. `chainIndexes` / `chainConstraints` are caller-provided
 * so the auto-refresh useEffect can pass identical snapshots to preview and
 * commit.
 */
export function buildPlanRequest(
  chainIndexes: IndexDraft[],
  chainConstraints: DeclaredConstraint[],
  previewOnly: boolean,
  args: BuildPlanRequestArgs,
): CreateTablePlanRequest {
  const base = buildRequest(previewOnly, args);
  const planIndexes: CreateTablePlanIndex[] = chainIndexes.map((idx) => ({
    indexName: idx.name.trim(),
    columns: idx.columns.map((c) => c.trim()).filter((c) => c.length > 0),
    indexType: idx.index_type,
    isUnique: idx.unique,
  }));
  const planConstraints: CreateTablePlanConstraint[] = chainConstraints.map(
    (c) => ({
      constraintName: c.name,
      definition: c.definition,
    }),
  );
  return {
    connectionId: base.connection_id,
    schema: base.schema,
    name: base.name,
    columns: base.columns,
    primaryKey: base.primary_key,
    tableComment: base.table_comment ?? null,
    indexes: planIndexes,
    constraints: planConstraints,
    previewOnly,
    // Opt-in DbMismatch guard. Forward workspace db so CREATE TABLE rejects
    // with `AppError::DbMismatch` if the connection pool's active db has
    // diverged.
    expectedDatabase: args.database,
  };
}

export interface DeclaredConstraintsArgs {
  fks: ForeignKeyDraft[];
  checks: CheckDraft[];
  uniques: UniqueDraft[];
  columns: ColumnDraft[];
  tableName: string;
}

/**
 * The list of constraint drafts (FK + CHECK + UNIQUE) that the chain will
 * actually execute, after filtering out invalid rows. Order is
 * `[...validatedFks, ...validatedChecks, ...validatedUniques, ...inline]` —
 * declared family order, byte-stable across preview and execute.
 *
 * Filter rules:
 * - Empty trimmed name uses the auto-suggested name; the row only drops when
 *   name auto-suggestion can't fill (e.g. FK with no local columns).
 * - FK with empty local columns / empty ref table / empty ref columns is
 *   filtered out (not enough info to produce valid SQL).
 * - CHECK with whitespace-only expression is filtered out (backend would
 *   reject anyway).
 * - UNIQUE with empty columns is filtered out.
 */
export function computeDeclaredConstraints(
  args: DeclaredConstraintsArgs,
): DeclaredConstraint[] {
  const { fks, checks, uniques, columns, tableName } = args;
  const tableNameSafe = tableName.trim();
  const out: DeclaredConstraint[] = [];

  for (const f of fks) {
    const cols = f.columns.map((c) => c.trim()).filter((c) => c.length > 0);
    const refTable = f.ref_table.trim();
    const refCols = f.ref_columns
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cols.length === 0) continue;
    if (refTable.length === 0) continue;
    if (refCols.length === 0) continue;
    const autoName =
      cols.length > 0 && tableNameSafe.length > 0
        ? `fk_${tableNameSafe}_${cols.join("_")}`
        : "";
    const finalName = f.name.trim().length > 0 ? f.name.trim() : autoName;
    if (finalName.length === 0) continue;
    out.push({
      trackingId: f.trackingId,
      name: finalName,
      definition: {
        type: "foreign_key",
        columns: cols,
        reference_table: refTable,
        reference_columns: refCols,
        on_delete: f.on_delete,
        on_update: f.on_update,
      },
    });
  }

  let checkIndex = 0;
  for (const c of checks) {
    checkIndex += 1;
    const expr = c.expression.trim();
    if (expr.length === 0) continue;
    const autoName =
      tableNameSafe.length > 0 ? `chk_${tableNameSafe}_${checkIndex}` : "";
    const finalName = c.name.trim().length > 0 ? c.name.trim() : autoName;
    if (finalName.length === 0) continue;
    out.push({
      trackingId: c.trackingId,
      name: finalName,
      definition: {
        type: "check",
        expression: expr,
      },
    });
  }

  for (const u of uniques) {
    const cols = u.columns.map((c) => c.trim()).filter((c) => c.length > 0);
    if (cols.length === 0) continue;
    const autoName =
      cols.length > 0 && tableNameSafe.length > 0
        ? `uq_${tableNameSafe}_${cols.join("_")}`
        : "";
    const finalName = u.name.trim().length > 0 ? u.name.trim() : autoName;
    if (finalName.length === 0) continue;
    out.push({
      trackingId: u.trackingId,
      name: finalName,
      definition: {
        type: "unique",
        columns: cols,
      },
    });
  }

  // Pick up inline single-column FK / CHECK declared on column rows
  // (TablePlus parity). Auto-name uses the column name so multiple rows with
  // the same target table don't collide. Empty ref_schema falls back to the
  // table's own schema so the user only has to pick a different schema when
  // the target lives in another one.
  for (const col of columns) {
    const colName = col.name.trim();
    if (colName.length === 0) continue;

    const refTable = col.fk_ref_table.trim();
    const refColumn = col.fk_ref_column.trim();
    if (refTable.length > 0 && refColumn.length > 0) {
      const fkName =
        tableNameSafe.length > 0 ? `fk_${tableNameSafe}_${colName}` : "";
      if (fkName.length > 0) {
        // Inline FK reference targets share the table's own schema — matches
        // the Constraints tab behaviour (the backend's
        // `ConstraintDefinition::ForeignKey` does not yet accept a separate
        // schema; cross-schema FKs are deferred).
        out.push({
          trackingId: `inline-fk-${col.trackingId}`,
          name: fkName,
          definition: {
            type: "foreign_key",
            columns: [colName],
            reference_table: refTable,
            reference_columns: [refColumn],
            on_delete: col.fk_on_delete,
            on_update: col.fk_on_update,
          },
        });
      }
    }

    const expr = col.check_expression.trim();
    if (expr.length > 0) {
      const chkName =
        tableNameSafe.length > 0 ? `chk_${tableNameSafe}_${colName}` : "";
      if (chkName.length > 0) {
        out.push({
          trackingId: `inline-chk-${col.trackingId}`,
          name: chkName,
          definition: {
            type: "check",
            expression: expr,
          },
        });
      }
    }
  }

  return out;
}
