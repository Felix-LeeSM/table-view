// MySQL dialect — Sprint 250 seed infrastructure for Phase 17 MySQL adapter.
//
// Mirrors `postgres.ts` export shape (envConn / ensure / drop / isPopulated /
// apply), but `applyMysql` is intentionally NotImplemented until the MySQL
// adapter lands (Sprint 251-256). Phase 17 sprints extend this module with
// dialect-correct DDL + parameterized inserts; until then the connection +
// lifecycle helpers are enough to wire docker-compose + the e2e e2e plumbing.
//
// `applyMysql` throws on call rather than silently no-op so a future caller
// who forgets to implement it doesn't ship empty-seed flakiness.
import { createConnection, type Connection } from "mysql2/promise";
import type { ResolvedSpec } from "./spec.js";
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

/**
 * Probe whether the profile's first MySQL-targeted entity has any rows.
 * No entities target MySQL today (Phase 17 will introduce a `mysql`
 * target variant in `BaseSpec`), so this always returns false — i.e. a
 * future `pnpm db:seed` invocation with `--target mysql` will never
 * short-circuit on "already seeded".
 */
export async function mysqlIsPopulated(
  conn: MysqlConnection,
  dbName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  // Sprint 250: spec schema has no `mysql` target yet. Phase 17 Sprint 251
  // extends `EntitySchema.targets` to include `"mysql"`; until then this is
  // a stable "no" so callers don't accidentally skip seeding. `void`s below
  // mirror postgres.ts's pattern for params held for future implementation.
  void conn;
  void dbName;
  void spec;
  void entityOrder;
  return false;
}

/**
 * Apply spec-driven schema + data to MySQL.
 *
 * Intentionally not yet implemented — the MySQL adapter (Sprint 253)
 * will introduce the dialect-correct DDL (BIGINT AUTO_INCREMENT primary
 * keys, InnoDB engine, FK constraints) + parameterized batched inserts.
 * For Sprint 250 the canonical mirror lives in `e2e/fixtures/seed.mysql.sql`
 * and is applied via `mysql ... < seed.mysql.sql` against the
 * docker-compose container.
 *
 * Throwing on call (vs silent no-op) protects future callers from shipping
 * empty-seed flakiness — the failure surfaces loudly the moment a profile
 * adds a `mysql` target.
 */
export async function applyMysql(
  conn: MysqlConnection,
  dbName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  void conn;
  void dbName;
  void spec;
  void rows;
  void log;
  throw new Error(
    "applyMysql: not yet implemented. Sprint 250 ships only the connection " +
      "helpers + e2e/fixtures/seed.mysql.sql; the dialect-correct schema/insert " +
      "path lands with the MySQL adapter in Phase 17 (Sprint 251-256).",
  );
}
