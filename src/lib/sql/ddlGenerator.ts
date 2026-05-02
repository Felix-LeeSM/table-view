// AC-192-01 — RDB schema 의 모든 테이블에 대한 migration DDL (CREATE
// TABLE / CREATE INDEX / ALTER TABLE ADD CONSTRAINT FOREIGN KEY) 을
// 한 string 으로 합성하는 lib pure 함수. 외부 도구 (`pg_dump` /
// `mysqldump`) 를 거치지 않고 schemaStore 가 이미 보유한 metadata
// (ColumnInfo / IndexInfo / ConstraintInfo) 만으로 직접 조립.
//
// 책임 경계 (D-2): 본 모듈은 React / IPC / IO 를 모르는 순수 함수
// 만 export. 호출자 (useMigrationExport hook) 가 metadata 수집과
// dialog / Tauri 호출을 담당.
//
// 본 lib 의 한계 (Sprint 192 OOS):
//  - views / functions / sequences / generated columns 미지원.
//  - column.data_type 은 backend 에서 받은 dialect-native 문자열을
//    그대로 emit — normalisation 시도 안 함.
//  - DEFAULT 값도 raw — `now()` 같은 함수 호출이나 JSON literal 도
//    backend 가 준 그대로 사용.
//
// date 2026-05-02.
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "@/types/schema";

export type DdlDialect = "postgresql" | "mysql" | "sqlite";

export interface DdlExportTable {
  name: string;
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  constraints: ConstraintInfo[];
}

export interface GenerateMigrationDDLParams {
  dialect: DdlDialect;
  /**
   * Logical schema name. PostgreSQL 의 schema, MySQL 의 database 에
   * 해당. SQLite 는 schema 개념이 없어 무시하지만 헤더 주석에는
   * 적힌다 (사용자가 어디서 export 한 것인지 식별).
   */
  schema: string;
  tables: DdlExportTable[];
  /**
   * 헤더 주석에 박힐 timestamp. 테스트 결정성을 위해 주입 — 미지정
   * 시 호출 시점의 `new Date()` 사용.
   */
  generatedAt?: Date;
}

const HEADER_VERSION = "table-view migration export v1";

/**
 * AC-192-01 entry point. 입력된 metadata 로부터 dialect-올바른
 * migration DDL 을 합성. 출력 string 은 한 줄짜리 statement 들이
 * 빈 줄로 구분된 형태 — 그대로 `psql` / `mysql` / `sqlite3` CLI 에
 * 던질 수 있다.
 */
export function generateMigrationDDL(
  params: GenerateMigrationDDLParams,
): string {
  const { dialect, schema, tables, generatedAt = new Date() } = params;

  const sections: string[] = [];

  sections.push(buildHeader(dialect, schema, tables, generatedAt));

  // 1) CREATE TABLE 들 — FK 는 여기서 emit 하지 않고 마지막 단계로
  //    미루기 때문에 forward reference / circular 를 걱정할 필요가
  //    없다. 컬럼 정의 + 단일/복합 PK 만 inline.
  for (const table of tables) {
    sections.push(buildCreateTable(dialect, schema, table));
  }

  // 2) Secondary index 들 — primary key 인덱스는 CREATE TABLE 의
  //    PRIMARY KEY 로 이미 표현됐으니 skip.
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

  // 3) Foreign key constraints — 모든 테이블이 만들어진 뒤 적용.
  //    pk / unique / check 는 본 sprint 의 OOS (constraint 의
  //    primary 표현은 CREATE TABLE 에서 처리, unique 는 보통 unique
  //    index 로 중복 표현되어 skip, check 는 expression 미보유로 skip).
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

  return sections.join("\n\n") + "\n";
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

  // 복합 PK 만 테이블 라인으로 emit. 단일 PK 는 column line 안의
  // PRIMARY KEY 로 표현된다.
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
  // Sprint 192 — PG `nextval('xxx'::regclass)` default 는 BIGSERIAL/SERIAL/
  // SMALLSERIAL 의 syntactic sugar 로 정규화한다. 이렇게 하면 import 시
  // CREATE SEQUENCE 가 자동 emit 되고 sequence 이름 규칙
  // (`<table>_<col>_seq`) 도 PG default 와 일치. NOT NULL 도 SERIAL 에
  // 내장이므로 제거. row 가 INSERT 된 후 sequence next 값을 reset 하는
  // setval 줄은 dump 끝에 별도 emit (`buildSequenceResets`).
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
 * PG nextval default 를 SERIAL family 로 매핑. nextval 의 sequence name
 * 인자는 regclass cast 가 있어도 없어도 OK — `nextval(` prefix 만 본다.
 * 단순히 type 만 바꾸면 PG 가 사용자의 기존 sequence 와 새 sequence 간
 * 충돌을 일으킬 수 있어 주의가 필요하지만, 이름 규칙이 일치하면 PG 는
 * 동일한 sequence 를 재생성한다.
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
 * Sprint 192 — DML import 후 sequence next value 를 row 의 max 로 reset.
 * BIGSERIAL 정규화로 sequence 자체는 자동 생성되지만 nextval 은 1 로
 * 시작 — INSERT row 의 PK 값이 1 이상이면 후속 INSERT 가 충돌한다.
 * `pg_get_serial_sequence` + `setval` 조합은 idempotent (빈 테이블이면
 * COALESCE(NULL, 1) → 1).
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
  // PG / SQLite 는 `CREATE INDEX name ON tbl (...)`, MySQL 도 동일
  // 형식을 받아 들임 (`CREATE INDEX idx ON tbl (col)`). MySQL 은
  // `ALTER TABLE ... ADD INDEX` 형식을 더 즐겨 쓰지만 mysql CLI 는
  // `CREATE INDEX` 도 똑같이 해석하므로 한 형식으로 통일.
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
  if (dialect === "mysql") {
    // MySQL: backtick quoting, embedded backtick은 두 개로 escape.
    return "`" + raw.replace(/`/g, "``") + "`";
  }
  // PG / SQLite: ANSI double quotes, embedded double-quote 두 개로.
  return '"' + raw.replace(/"/g, '""') + '"';
}

function qualifiedName(
  dialect: DdlDialect,
  schema: string,
  table: string,
): string {
  // SQLite 는 schema 개념이 없어 unqualified 가 정상. attached DB 를
  // 별도 schema 로 export 하는 use case 는 본 sprint OOS.
  if (dialect === "sqlite") return quoteIdent(dialect, table);
  return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
}
