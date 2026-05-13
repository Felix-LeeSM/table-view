// MySQL dialect — schema/table DDL + parameterized batched INSERT.
// Sprint 250 시작 시엔 connection helper 만 — 본격 seed path 는 Sprint 288
// (Phase 17 gap fix) 에서 합류. PG `postgres.ts` 의 export shape (envConn /
// ensure / drop / isPopulated / apply) 를 그대로 답습한다.
import { createConnection, type Connection } from "mysql2/promise";
import type { BaseSpec, Column, ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";

export interface MysqlConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

export function mysqlEnvConn(): MysqlConnection {
  return {
    host: process.env.MYSQL_HOST ?? "localhost",
    // docker-compose binds the test container to 13306 by default
    // (`prod default 3306 + 10000`). `MYSQL_PORT` env override matches the
    // compose-level override variable for symmetry.
    port: Number(process.env.MYSQL_PORT ?? 13306),
    user: process.env.MYSQL_USER ?? "testuser",
    password: process.env.MYSQL_PASSWORD ?? "testpass",
  };
}

/**
 * Sprint 281 — fixture profile 의 mysql DB 를 ensure 하고 testuser GRANT
 * 까지 부여하려면 root 권한 필요. docker-compose mysql 의 entrypoint 가
 * `MYSQL_DATABASE` 한 개만 만들고 그 DB 에만 testuser GRANT 를 부여하므로,
 * fixture 가 그 외 DB (table_view_development, table_view_e2e) 를 쓰려면
 * root 로 별도 GRANT 가 필요하다.
 */
export function mysqlRootEnvConn(): MysqlConnection {
  return {
    host: process.env.MYSQL_HOST ?? "localhost",
    port: Number(process.env.MYSQL_PORT ?? 13306),
    user: "root",
    password: process.env.MYSQL_ROOT_PASSWORD ?? "testroot",
  };
}

async function withClient<T>(
  conn: MysqlConnection,
  database: string | null,
  fn: (c: Connection) => Promise<T>,
): Promise<T> {
  const client = await createConnection({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    // `database: undefined` connects without selecting a DB — used by
    // ensure/drop helpers that operate on the server catalog directly.
    ...(database !== null ? { database } : {}),
    multipleStatements: false,
  });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Connect without selecting a DB and `CREATE DATABASE IF NOT EXISTS`.
 * Mirrors `ensurePgDatabase` but uses MySQL's idempotent CREATE syntax
 * directly (no need for a separate SELECT-then-CREATE round trip).
 */
export async function ensureMysqlDatabase(
  conn: MysqlConnection,
  dbName: string,
): Promise<void> {
  await withClient(conn, null, async (c) => {
    // Backtick-quote and double-escape any literal backticks in the name to
    // mirror the identifier-quoting safety we use in postgres.ts.
    const quoted = "`" + dbName.replace(/`/g, "``") + "`";
    await c.query(
      `CREATE DATABASE IF NOT EXISTS ${quoted} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  });
}

/**
 * Sprint 281 — fixture profile 이 명시한 mysql DB 를 root 권한으로 만들고
 * testuser 에게 ALL PRIVILEGES 를 부여한다. docker-compose mysql 의
 * entrypoint 는 `MYSQL_DATABASE` 한 개만 만들고 거기에만 testuser 권한
 * 을 자동 부여 — 그 외 DB 는 connect 시 1044 (Access denied) 가 나므로
 * `db:connections upsert <profile>` 가 사용자에게 working connection 을
 * 제공하려면 이 단계가 필수.
 *
 * 식별자 escape: `username` 은 환경변수 입력이라 외부 사용자 제어 영역이
 * 아니지만 single-quote 한 글자만 안전을 위해 double-escape.
 */
export async function ensureMysqlDatabaseAndGrant(
  rootConn: MysqlConnection,
  dbName: string,
  username: string,
): Promise<void> {
  await withClient(rootConn, null, async (c) => {
    const quotedDb = "`" + dbName.replace(/`/g, "``") + "`";
    const quotedUser = "'" + username.replace(/'/g, "''") + "'";
    await c.query(
      `CREATE DATABASE IF NOT EXISTS ${quotedDb} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await c.query(`GRANT ALL PRIVILEGES ON ${quotedDb}.* TO ${quotedUser}@'%'`);
    await c.query(`FLUSH PRIVILEGES`);
  });
}

export async function dropMysqlDatabase(
  conn: MysqlConnection,
  dbName: string,
): Promise<void> {
  await withClient(conn, null, async (c) => {
    const quoted = "`" + dbName.replace(/`/g, "``") + "`";
    await c.query(`DROP DATABASE IF EXISTS ${quoted}`);
  });
}

/** Probe whether the profile's first MySQL-targeted entity has any rows. */
export async function mysqlIsPopulated(
  conn: MysqlConnection,
  dbName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("mysql"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.mysql) return false;
  return withClient(conn, dbName, async (c) => {
    try {
      const quoted = "`" + entity.mysql!.table.replace(/`/g, "``") + "`";
      const [rows] = await c.query(`SELECT 1 FROM ${quoted} LIMIT 1`);
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  });
}

/**
 * Apply spec-driven schema + data to MySQL. PG `applyPostgres` 와 같은 구조:
 * 1) 모든 entity 에 대해 `CREATE TABLE IF NOT EXISTS` (FK 는 별 round-trip).
 * 2) ref column → FK constraint (`ADD CONSTRAINT` — 이미 존재하면 ignore).
 * 3) row 데이터를 500개 단위 batch insert.
 *
 * MySQL dialect 차이:
 * - PK: PG uuid → MySQL CHAR(36). UUID 타입이 8.0+ 에서도 native 가 없어
 *   문자열로 적재 (sqlx 가 String 으로 decode).
 * - timestamp: PG `timestamptz` → MySQL DATETIME(6) (UTC 가정).
 * - jsonb → JSON. array_of → JSON (배열을 그대로 JSON 직렬화).
 * - decimal: DECIMAL(12,2) — PG 와 동일.
 * - boolean: TINYINT(1).
 * - identifier quoting: backtick.
 */
export async function applyMysql(
  conn: MysqlConnection,
  dbName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  await withClient(conn, dbName, async (c) => {
    await migrateSchemas(c, spec.base);
    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity || !entity.mysql || !entity.targets.includes("mysql"))
        continue;
      const data = rows[entityName] ?? [];
      const start = Date.now();
      await insertEntity(c, entity, data);
      log(entityName, data.length, Date.now() - start);
    }
  });
}

async function migrateSchemas(c: Connection, base: BaseSpec): Promise<void> {
  // (1) 모든 base table — FK 없이 만들고.
  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.mysql || !entity.targets.includes("mysql")) continue;
    const ddl = buildCreateTable(name, entity.mysql.table, entity.columns);
    await c.query(ddl);
  }
  // (2) FK 부착 — 이미 존재하면 ER_FK_DUP_NAME (1826) 또는 ER_DUP_KEYNAME 무시.
  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.mysql || !entity.targets.includes("mysql")) continue;
    for (const [colName, col] of Object.entries(entity.columns)) {
      if (col.type !== "ref" || !col.to) continue;
      const [refEntity, refCol] = col.to.split(".");
      if (!refEntity || !refCol) continue;
      const target = base.entities[refEntity];
      if (!target?.mysql || !target.targets.includes("mysql")) continue;
      const cName = `fk_${entity.mysql.table}_${colName}`;
      const quotedTable = "`" + entity.mysql.table.replace(/`/g, "``") + "`";
      const quotedCol = "`" + colName.replace(/`/g, "``") + "`";
      const quotedConstraint = "`" + cName.replace(/`/g, "``") + "`";
      const quotedRefTable = "`" + target.mysql.table.replace(/`/g, "``") + "`";
      const quotedRefCol = "`" + refCol.replace(/`/g, "``") + "`";
      try {
        await c.query(
          `ALTER TABLE ${quotedTable} \
           ADD CONSTRAINT ${quotedConstraint} FOREIGN KEY (${quotedCol}) \
           REFERENCES ${quotedRefTable} (${quotedRefCol})`,
        );
      } catch (err: unknown) {
        // MySQL "Duplicate foreign key constraint name" / "Duplicate key" 무시.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/Duplicate/i.test(msg) && !/already exists/i.test(msg)) throw err;
      }
      void name;
    }
  }
}

function buildCreateTable(
  entityName: string,
  table: string,
  columns: Record<string, Column>,
): string {
  const cols: string[] = [];
  const primaryKeys: string[] = [];
  const uniqueCols: string[] = [];

  for (const [name, col] of Object.entries(columns)) {
    const sqlType = mapType(col);
    const constraints: string[] = [];
    if (col.primary) primaryKeys.push("`" + name.replace(/`/g, "``") + "`");
    else if (col.nullable !== true) constraints.push("NOT NULL");
    if (col.unique && !col.primary)
      uniqueCols.push("`" + name.replace(/`/g, "``") + "`");
    cols.push(
      `  \`${name.replace(/`/g, "``")}\` ${sqlType}${constraints.length ? " " + constraints.join(" ") : ""}`,
    );
  }
  if (primaryKeys.length > 0)
    cols.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
  for (const u of uniqueCols) cols.push(`  UNIQUE (${u})`);

  void entityName;
  const quotedTable = "`" + table.replace(/`/g, "``") + "`";
  return `CREATE TABLE IF NOT EXISTS ${quotedTable} (\n${cols.join(",\n")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

function mapType(col: Column): string {
  switch (col.type) {
    case "uuid":
      return "CHAR(36)";
    case "email":
    case "full_name":
    case "product_name":
    case "sku":
    case "phone":
    case "address":
      // utf8mb4 의 4-byte char 한도와 InnoDB row format 을 감안해 VARCHAR(N)
      // 으로 cap. max_length 미지정시 VARCHAR(255) — TEXT 로 떨어지면 UNIQUE
      // key 생성 시 MySQL 이 length 명시를 요구해 schema migration 이 실패.
      return col.max_length ? `VARCHAR(${col.max_length})` : "VARCHAR(255)";
    case "text":
      return col.max_length ? `VARCHAR(${col.max_length})` : "TEXT";
    case "decimal":
      return "DECIMAL(12, 2)";
    case "int":
      return "INT";
    case "timestamp":
      // MySQL DATETIME(6) — TZ 없는 wall-clock. fixture 측은 UTC ISO
      // string 으로 생성하므로 String 으로 적재 (server side parsing).
      return "DATETIME(6)";
    case "boolean":
      return "TINYINT(1)";
    case "enum":
      // PG 와 동일 — VARCHAR + CHECK 은 적용 안 함 (run-time validation 가벼움).
      return "VARCHAR(64)";
    case "json":
      return "JSON";
    case "array_of":
      // MySQL 은 array native 가 없음 — JSON 배열로 직렬화.
      return "JSON";
    case "ref":
      return "CHAR(36)";
    default:
      return "TEXT";
  }
}

async function insertEntity(
  c: Connection,
  entity: {
    mysql?: { table: string };
    columns: Record<string, Column>;
  },
  data: Record<string, unknown>[],
): Promise<void> {
  if (!entity.mysql || data.length === 0) return;
  const colNames = Object.keys(entity.columns);
  const quoted = colNames
    .map((n) => "`" + n.replace(/`/g, "``") + "`")
    .join(", ");
  const target = "`" + entity.mysql.table.replace(/`/g, "``") + "`";

  // 500-row batch.
  const batchSize = 500;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    for (const row of batch) {
      const slot = colNames.map(() => "?").join(", ");
      placeholders.push(`(${slot})`);
      for (const colName of colNames) {
        params.push(coerceForMysql(entity.columns[colName]!, row[colName]));
      }
    }
    await c.query(
      `INSERT INTO ${target} (${quoted}) VALUES ${placeholders.join(", ")}`,
      params,
    );
  }
}

function coerceForMysql(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.type === "array_of")
    return JSON.stringify(Array.isArray(v) ? v : [v]);
  if (col.type === "json") return JSON.stringify(v);
  if (col.type === "timestamp" && v instanceof Date) {
    // MySQL DATETIME(6) 은 'YYYY-MM-DD HH:MM:SS.uuuuuu' 가 canonical —
    // mysql2 의 default 직렬화는 ISO 8601 이라 TZ suffix 가 붙는다. 잘라낸다.
    const iso = v.toISOString();
    return iso.replace("T", " ").replace("Z", "");
  }
  if (col.type === "timestamp" && typeof v === "string") {
    return v.replace("T", " ").replace(/Z$|[+-]\d\d:?\d\d$/, "");
  }
  if (col.type === "boolean") return v ? 1 : 0;
  return v;
}
