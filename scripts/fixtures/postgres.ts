// PG dialect: schema/table DDL + parameterized batched INSERT.
// `applyPostgres` ensures the profile DB exists (system DB connection),
// then connects to it for schema + data work.
import { Client } from "pg";
import type { BaseSpec, Column, ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";

export interface PgConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

export function pgEnvConn(): PgConnection {
  return {
    host: process.env.PGHOST ?? "localhost",
    port: Number(process.env.PGPORT ?? 15432),
    user: process.env.PGUSER ?? "testuser",
    password: process.env.PGPASSWORD ?? "testpass",
  };
}

async function withClient<T>(
  conn: PgConnection,
  database: string,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ ...conn, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Connect to the system `postgres` DB and CREATE DATABASE if missing. */
export async function ensurePgDatabase(
  conn: PgConnection,
  dbName: string,
): Promise<void> {
  await withClient(conn, "postgres", async (c) => {
    const r = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      dbName,
    ]);
    if (r.rowCount === 0) {
      await c.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    }
  });
}

export async function dropPgDatabase(
  conn: PgConnection,
  dbName: string,
): Promise<void> {
  await withClient(conn, "postgres", async (c) => {
    // Force-disconnect any active sessions before dropping.
    await c.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [dbName],
    );
    await c.query(`DROP DATABASE IF EXISTS "${dbName.replace(/"/g, '""')}"`);
  });
}

/** Probe whether the profile's first PG-targeted entity has any rows. */
export async function pgIsPopulated(
  conn: PgConnection,
  dbName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("pg"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.pg) return false;
  return withClient(conn, dbName, async (c) => {
    try {
      const r = await c.query(
        `SELECT 1 FROM "${entity.pg!.schema}"."${entity.pg!.table}" LIMIT 1`,
      );
      return (r.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  });
}

export async function applyPostgres(
  conn: PgConnection,
  dbName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  await withClient(conn, dbName, async (c) => {
    await migrateSchemas(c, spec.base);
    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity || !entity.pg || !entity.targets.includes("pg")) continue;
      const data = rows[entityName] ?? [];
      const start = Date.now();
      await insertEntity(c, entity, data);
      log(entityName, data.length, Date.now() - start);
    }
  });
}

async function migrateSchemas(c: Client, base: BaseSpec): Promise<void> {
  const schemas = new Set<string>();
  for (const entity of Object.values(base.entities)) {
    if (entity.pg && entity.targets.includes("pg"))
      schemas.add(entity.pg.schema);
  }
  for (const s of schemas) {
    await c.query(`CREATE SCHEMA IF NOT EXISTS "${s.replace(/"/g, '""')}"`);
  }

  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.pg || !entity.targets.includes("pg")) continue;
    const ddl = buildCreateTable(
      name,
      entity.pg.schema,
      entity.pg.table,
      entity.columns,
    );
    await c.query(ddl);
  }

  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.pg || !entity.targets.includes("pg")) continue;
    for (const [colName, col] of Object.entries(entity.columns)) {
      if (col.type !== "ref" || !col.to) continue;
      const [refEntity, refCol] = col.to.split(".");
      if (!refEntity || !refCol) continue;
      const target = base.entities[refEntity];
      if (!target?.pg || !target.targets.includes("pg")) continue;
      const cName = `fk_${entity.pg.table}_${colName}`;
      try {
        await c.query(
          `ALTER TABLE "${entity.pg.schema}"."${entity.pg.table}"
           ADD CONSTRAINT "${cName}" FOREIGN KEY ("${colName}")
           REFERENCES "${target.pg.schema}"."${target.pg.table}" ("${refCol}") DEFERRABLE INITIALLY DEFERRED`,
        );
      } catch (err: unknown) {
        // ignore "already exists"
        if (!(err instanceof Error) || !/already exists/.test(err.message))
          throw err;
      }
      void name;
    }
  }
}

function buildCreateTable(
  entityName: string,
  schema: string,
  table: string,
  columns: Record<string, Column>,
): string {
  const cols: string[] = [];
  const primaryKeys: string[] = [];
  const uniqueCols: string[] = [];

  for (const [name, col] of Object.entries(columns)) {
    const sqlType = mapType(col);
    const constraints: string[] = [];
    if (col.primary) primaryKeys.push(`"${name}"`);
    else if (col.nullable !== true) constraints.push("NOT NULL");
    if (col.unique && !col.primary) uniqueCols.push(`"${name}"`);
    cols.push(
      `  "${name}" ${sqlType}${constraints.length ? " " + constraints.join(" ") : ""}`,
    );
  }
  if (primaryKeys.length > 0)
    cols.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
  for (const u of uniqueCols) cols.push(`  UNIQUE (${u})`);

  void entityName;
  return `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (\n${cols.join(",\n")}\n)`;
}

function mapType(col: Column): string {
  switch (col.type) {
    case "uuid":
      return "uuid";
    case "email":
    case "full_name":
    case "product_name":
    case "sku":
    case "phone":
    case "address":
      // No varchar fallback: when the spec doesn't pin a max_length we use
      // TEXT (unbounded). Defaulting to varchar(255) lets the very_long
      // edge category (2048 chars) tip a column over the limit and abort
      // the seed; TEXT keeps the column edge-safe by default. Authors
      // who do want a length cap declare `max_length` explicitly.
      return col.max_length ? `varchar(${col.max_length})` : "text";
    case "text":
      return col.max_length ? `varchar(${col.max_length})` : "text";
    case "decimal":
      return "numeric(12, 2)";
    case "int":
      return "integer";
    case "timestamp":
      return "timestamptz";
    case "boolean":
      return "boolean";
    case "enum":
      // Use varchar + CHECK could be added later; varchar is simplest.
      return "varchar(64)";
    case "json":
      return "jsonb";
    case "array_of":
      return "text[]";
    case "ref":
      return "uuid";
    default:
      return "text";
  }
}

async function insertEntity(
  c: Client,
  entity: {
    pg?: { schema: string; table: string };
    columns: Record<string, Column>;
  },
  data: Record<string, unknown>[],
): Promise<void> {
  if (!entity.pg || data.length === 0) return;
  const colNames = Object.keys(entity.columns);
  const quoted = colNames.map((n) => `"${n}"`).join(", ");
  const target = `"${entity.pg.schema}"."${entity.pg.table}"`;

  // Batch in 500-row groups for speed.
  const batchSize = 500;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    let p = 1;
    for (const row of batch) {
      const slot = colNames.map(() => `$${p++}`).join(", ");
      placeholders.push(`(${slot})`);
      for (const colName of colNames) {
        params.push(coerceForPg(entity.columns[colName]!, row[colName]));
      }
    }
    await c.query(
      `INSERT INTO ${target} (${quoted}) VALUES ${placeholders.join(", ")}`,
      params,
    );
  }
}

function coerceForPg(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.type === "array_of") return Array.isArray(v) ? v : [v];
  if (col.type === "json") return JSON.stringify(v);
  return v;
}
