// Pure helper that builds migration DDL (CREATE TABLE / CREATE INDEX /
// ALTER TABLE ADD CONSTRAINT FOREIGN KEY) for every table in an RDB
// schema. No `pg_dump` / `mysqldump` — assembles directly from the
// metadata schemaStore already holds.
//
// Pure module: no React / IPC / IO. The caller (`useMigrationExport`)
// handles metadata collection, the save dialog, and Tauri dispatch.
//
// Out of scope: views, functions, sequences, generated columns. The
// `column.data_type` and DEFAULT values are emitted verbatim from the
// backend — no normalisation.
import type { ColumnInfo, ConstraintInfo, IndexInfo } from "@/types/schema";
import { type SqlDialect, sqlIdentifier } from "./sqlLiteral";

export type DdlDialect =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "mssql"
  | "oracle";

export interface DdlExportTable {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
}

export interface GenerateMigrationDDLParams {
  dialect: DdlDialect;
  /**
   * Logical schema name. Corresponds to a PostgreSQL schema or a MySQL
   * database. SQLite has no schema concept, so it is ignored there, but it
   * is still written into the header comment (so the user can tell where
   * the export came from).
   */
  schema: string;
  tables: DdlExportTable[];
  /**
   * Timestamp written into the header comment. Injected for test
   * determinism — when omitted, `new Date()` at call time is used.
   */
  generatedAt?: Date;
}

const HEADER_VERSION = "table-view migration export v1";

/**
 * AC-192-01 entry point. Synthesizes dialect-correct migration DDL from the
 * given metadata. The output string is a series of sections separated by
 * blank lines — it can be fed as-is to the `psql` / `mysql` / `sqlite3`
 * CLI.
 */
export function generateMigrationDDL(
  params: GenerateMigrationDDLParams,
): string {
  const { dialect, schema, tables, generatedAt = new Date() } = params;

  const sections: string[] = [];

  sections.push(buildHeader(dialect, schema, tables, generatedAt));

  // 1) CREATE TABLE statements — FKs are not emitted here but deferred to
  //    the last step, so forward references / circular references are not
  //    a concern. Only column definitions + single/composite PKs go inline.
  for (const table of tables) {
    sections.push(buildCreateTable(dialect, schema, table));
  }

  // 2) Secondary indexes — the primary key index is skipped because the
  //    CREATE TABLE's PRIMARY KEY already expresses it.
  const indexLines: string[] = [];
  for (const table of tables) {
    for (const idx of table.indexes) {
      if (idx.is_primary) continue;
      indexLines.push(buildCreateIndex(dialect, schema, table.name, idx));
    }
  }
  if (indexLines.length > 0) {
    sections.push(["-- Indexes", ...indexLines].join("\n"));
  }

  // 3) Foreign key constraints — applied after all tables are created.
  //    pk / unique / check are out of scope (the primary constraint is
  //    expressed in CREATE TABLE, unique is skipped because a unique index
  //    usually duplicates it, and check is skipped because no expression
  //    is held).
  const fkLines: string[] = [];
  for (const table of tables) {
    for (const c of table.constraints) {
      if (c.constraint_type !== "fk" && c.constraint_type !== "FOREIGN KEY")
        continue;
      const fk = buildAddForeignKey(dialect, schema, table.name, c);
      if (fk !== null) fkLines.push(fk);
    }
  }
  if (fkLines.length > 0) {
    sections.push(["-- Foreign keys", ...fkLines].join("\n"));
  }

  return `${sections.join("\n\n")}\n`;
}

// ── Header ─────────────────────────────────────────────────────────────

function buildHeader(
  dialect: DdlDialect,
  schema: string,
  tables: DdlExportTable[],
  generatedAt: Date,
): string {
  const iso = generatedAt.toISOString();
  return [
    `-- ${HEADER_VERSION}`,
    `-- dialect: ${dialect}`,
    `-- schema:  ${schema}`,
    `-- tables:  ${tables.length}`,
    `-- generated: ${iso}`,
    "-- NOTE: views / functions / data are NOT included — this is a",
    "--       structure-only export (CREATE TABLE / INDEX / FOREIGN KEY).",
  ].join("\n");
}

// ── CREATE TABLE ───────────────────────────────────────────────────────

function buildCreateTable(
  dialect: DdlDialect,
  schema: string,
  table: DdlExportTable,
): string {
  const qualified = qualifiedName(dialect, schema, table.name);
  const pkColumns = table.columns
    .filter((c) => c.is_primary_key)
    .map((c) => c.name);

  const columnLines = table.columns.map((col) => {
    return formatColumnLine(dialect, col, pkColumns.length === 1);
  });

  // Only a composite PK is emitted as a table-level line. A single PK is
  // expressed as PRIMARY KEY inside its column line.
  const tableLevelLines: string[] = [];
  if (pkColumns.length > 1) {
    const cols = pkColumns.map((c) => quoteIdent(dialect, c)).join(", ");
    tableLevelLines.push(`  PRIMARY KEY (${cols})`);
  }

  const body = [...columnLines.map((l) => `  ${l}`), ...tableLevelLines].join(
    ",\n",
  );

  return `CREATE TABLE ${qualified} (\n${body}\n);`;
}

function formatColumnLine(
  dialect: DdlDialect,
  col: ColumnInfo,
  inlinePrimaryKey: boolean,
): string {
  // Normalise PG `nextval('xxx'::regclass)` defaults to
  // BIGSERIAL/SERIAL/SMALLSERIAL syntactic sugar. On import this auto-
  // emits CREATE SEQUENCE and matches PG's default sequence-name rule
  // (`<table>_<col>_seq`). NOT NULL is implicit in SERIAL so it's
  // dropped here; the post-INSERT setval lines are emitted separately
  // by `buildSequenceResets`.
  if (dialect === "postgresql") {
    const serialType = mapPgNextvalToSerial(col);
    if (serialType !== null) {
      const parts: string[] = [quoteIdent(dialect, col.name), serialType];
      if (inlinePrimaryKey && col.is_primary_key) parts.push("PRIMARY KEY");
      return parts.join(" ");
    }
  }
  const parts: string[] = [quoteIdent(dialect, col.name), col.data_type];
  if (!col.nullable) parts.push("NOT NULL");
  if (col.default_value !== null && col.default_value !== "") {
    parts.push(`DEFAULT ${col.default_value}`);
  }
  if (inlinePrimaryKey && col.is_primary_key) {
    parts.push("PRIMARY KEY");
  }
  return parts.join(" ");
}

/**
 * Map a PG nextval default to the SERIAL family. The sequence-name
 * argument of nextval may or may not carry a regclass cast — only the
 * `nextval(` prefix is checked. Swapping only the type needs care, because
 * PG can end up with a conflict between the user's existing sequence and
 * the new one, but when the naming rule matches, PG recreates the same
 * sequence.
 */
function mapPgNextvalToSerial(col: ColumnInfo): string | null {
  const def = col.default_value;
  if (def === null || def === undefined || def === "") return null;
  if (!def.trim().startsWith("nextval(")) return null;
  switch (col.data_type.toLowerCase()) {
    case "bigint":
      return "BIGSERIAL";
    case "integer":
    case "int":
    case "int4":
      return "SERIAL";
    case "smallint":
    case "int2":
      return "SMALLSERIAL";
    default:
      return null;
  }
}

/**
 * After a DML import, reset every sequence to `MAX(pk) + 1`. The
 * BIGSERIAL normalisation auto-creates sequences but they restart at 1,
 * so a subsequent INSERT collides when imported rows already have PKs.
 * `pg_get_serial_sequence` + `setval` is idempotent — on an empty table
 * it collapses to `COALESCE(NULL, 1) → 1`.
 */
export function buildSequenceResets(
  dialect: DdlDialect,
  schema: string,
  tables: DdlExportTable[],
): string[] {
  if (dialect !== "postgresql") return [];
  const lines: string[] = [];
  for (const t of tables) {
    for (const c of t.columns) {
      if (mapPgNextvalToSerial(c) === null) continue;
      const tableLit = qualifiedName(dialect, schema, t.name);
      const colName = c.name.replace(/'/g, "''");
      lines.push(
        `SELECT setval(pg_get_serial_sequence('${tableLit.replace(/'/g, "''")}', '${colName}'), ` +
          `COALESCE((SELECT MAX(${quoteIdent(dialect, c.name)}) FROM ${tableLit}), 1));`,
      );
    }
  }
  return lines;
}

// ── CREATE INDEX ───────────────────────────────────────────────────────

function buildCreateIndex(
  dialect: DdlDialect,
  schema: string,
  tableName: string,
  idx: IndexInfo,
): string {
  const unique = idx.is_unique ? "UNIQUE " : "";
  const indexIdent = quoteIdent(dialect, idx.name);
  const tableIdent = qualifiedName(dialect, schema, tableName);
  const cols = idx.columns.map((c) => quoteIdent(dialect, c)).join(", ");
  // PG / SQLite use `CREATE INDEX name ON tbl (...)`, and MySQL accepts the
  // same form (`CREATE INDEX idx ON tbl (col)`). MySQL favors the
  // `ALTER TABLE ... ADD INDEX` form, but the mysql CLI reads
  // `CREATE INDEX` the same way, so a single form is used.
  return `CREATE ${unique}INDEX ${indexIdent} ON ${tableIdent} (${cols});`;
}

// ── ALTER TABLE ADD CONSTRAINT ... FOREIGN KEY ────────────────────────

function buildAddForeignKey(
  dialect: DdlDialect,
  schema: string,
  tableName: string,
  c: ConstraintInfo,
): string | null {
  if (!c.reference_table) return null;
  const refColumns = c.reference_columns ?? [];
  if (refColumns.length === 0) return null;
  const tableIdent = qualifiedName(dialect, schema, tableName);
  const refIdent = qualifiedName(dialect, schema, c.reference_table);
  const localCols = c.columns.map((col) => quoteIdent(dialect, col)).join(", ");
  const remoteCols = refColumns
    .map((col) => quoteIdent(dialect, col))
    .join(", ");
  return [
    `ALTER TABLE ${tableIdent}`,
    `  ADD CONSTRAINT ${quoteIdent(dialect, c.name)}`,
    `  FOREIGN KEY (${localCols}) REFERENCES ${refIdent} (${remoteCols});`,
  ].join("\n");
}

// ── Identifier / qualified name helpers ───────────────────────────────

function quoteIdent(dialect: DdlDialect, raw: string): string {
  // Route through the canonical quoter (#1357). DDL always quotes, so Postgres
  // takes `quotePostgres: true`; `mariadb` shares MySQL backtick semantics.
  const canonical: SqlDialect = dialect === "mariadb" ? "mysql" : dialect;
  return sqlIdentifier(raw, canonical, { quotePostgres: true });
}

function qualifiedName(
  dialect: DdlDialect,
  schema: string,
  table: string,
): string {
  // SQLite has no schema concept, so unqualified names are correct.
  // Exporting an attached DB as a separate schema is out of scope.
  if (dialect === "sqlite") return quoteIdent(dialect, table);
  return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
}
