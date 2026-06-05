// DuckDB dialect — file-based fixture generator with PG-compatible DDL.
// Mirrors `postgres.ts` export shape: envPath, ensure, drop, isPopulated, apply.
// Uses `duckdb` async Node.js API.
import duckdb, {
  type Connection as NativeDuckdbConnection,
  type Database as NativeDuckdbDatabase,
} from "duckdb";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BaseSpec, Column, ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";
import { defaultFileFixtureDir } from "./paths.js";

export interface DuckdbFixturePath {
  directory: string;
  fileName: string;
}

export function duckdbEnvPath(): DuckdbFixturePath {
  return {
    directory: process.env.DUCKDB_FIXTURE_DIR ?? defaultFixtureDir(),
    fileName: "",
  };
}

function defaultFixtureDir(): string {
  return defaultFileFixtureDir("duckdb");
}

function resolveDbPath(path: DuckdbFixturePath, fileName: string): string {
  return resolve(path.directory, fileName);
}

interface DuckdbConnection {
  run: (sql: string) => Promise<void>;
  all: (sql: string) => Promise<unknown[]>;
  close: () => Promise<void>;
}

async function withDb(
  dbPath: string,
  fn: (conn: DuckdbConnection) => Promise<void>,
  options?: { create?: boolean },
): Promise<void> {
  if (!options?.create && !existsSync(dbPath)) {
    throw new Error(`DuckDB file not found: ${dbPath}`);
  }
  mkdirSync(dirname(dbPath), { recursive: true });

  const database = new duckdb.Database(dbPath);
  const connection = database.connect();

  const conn: DuckdbConnection = {
    run: async (sql: string) => {
      await new Promise<void>((resolve, reject) => {
        connection.run(sql, (err) => {
          if (err) reject(new Error(err.message ?? String(err)));
          else resolve();
        });
      });
    },
    all: async (sql: string) => {
      return new Promise<unknown[]>((resolve, reject) => {
        connection.all(sql, (err, rows) => {
          if (err) reject(new Error(err.message ?? String(err)));
          else resolve(rows ?? []);
        });
      });
    },
    close: async () => {
      await closeDuckdb(connection, database);
    },
  };

  try {
    await fn(conn);
  } finally {
    await conn.close();
  }
}

async function closeDuckdb(
  connection: NativeDuckdbConnection,
  database: NativeDuckdbDatabase,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.close((err) => {
      if (err) reject(new Error(err.message ?? String(err)));
      else resolve();
    });
  });
  await new Promise<void>((resolve, reject) => {
    database.close((err) => {
      if (err) reject(new Error(err.message ?? String(err)));
      else resolve();
    });
  });
}

export async function ensureDuckdbDatabase(
  path: DuckdbFixturePath,
  fileName: string,
): Promise<void> {
  const dbPath = resolveDbPath(path, fileName);
  mkdirSync(dirname(dbPath), { recursive: true });
  if (!existsSync(dbPath)) {
    await withDb(dbPath, async () => {}, { create: true });
  }
}

export async function dropDuckdbDatabase(
  path: DuckdbFixturePath,
  fileName: string,
): Promise<void> {
  const dbPath = resolveDbPath(path, fileName);
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    const walPath = `${dbPath}.wal`;
    if (existsSync(walPath)) unlinkSync(walPath);
  }
}

export async function duckdbIsPopulated(
  path: DuckdbFixturePath,
  fileName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const dbPath = resolveDbPath(path, fileName);
  if (!existsSync(dbPath)) return false;
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("duckdb"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.duckdb) return false;
  try {
    let populated = false;
    await withDb(dbPath, async (conn) => {
      const rows = await conn.all(
        `SELECT 1 FROM "${entity.duckdb!.schema}"."${entity.duckdb!.table}" LIMIT 1`,
      );
      populated = rows.length > 0;
    });
    return populated;
  } catch {
    return false;
  }
}

export async function applyDuckdb(
  path: DuckdbFixturePath,
  fileName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  const dbPath = resolveDbPath(path, fileName);
  mkdirSync(dirname(dbPath), { recursive: true });

  await withDb(
    dbPath,
    async (conn) => {
      await migrateSchemas(conn, spec.base);

      for (const entityName of entityOrder(spec.base)) {
        const entity = spec.base.entities[entityName];
        if (!entity || !entity.duckdb || !entity.targets.includes("duckdb"))
          continue;
        const data = rows[entityName] ?? [];
        const start = Date.now();
        await insertEntity(conn, entity, data);
        log(entityName, data.length, Date.now() - start);
      }
    },
    { create: true },
  );
}

async function migrateSchemas(
  conn: DuckdbConnection,
  base: BaseSpec,
): Promise<void> {
  const schemas = new Set<string>();
  for (const entity of Object.values(base.entities)) {
    if (entity.duckdb && entity.targets.includes("duckdb"))
      schemas.add(entity.duckdb.schema);
  }
  for (const s of schemas) {
    await conn.run(`CREATE SCHEMA IF NOT EXISTS "${s.replace(/"/g, '""')}"`);
  }

  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.duckdb || !entity.targets.includes("duckdb")) continue;
    const ddl = buildCreateTable(
      name,
      entity.duckdb.schema,
      entity.duckdb.table,
      entity.columns,
      base,
    );
    await conn.run(ddl);
  }
}

function buildCreateTable(
  entityName: string,
  schema: string,
  table: string,
  columns: Record<string, Column>,
  base: BaseSpec,
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
  for (const [name, col] of Object.entries(columns)) {
    if (col.type !== "ref" || !col.to) continue;
    const [refEntity, refCol] = col.to.split(".");
    if (!refEntity || !refCol) continue;
    const target = base.entities[refEntity];
    if (!target?.duckdb || !target.targets.includes("duckdb")) continue;
    if (target.duckdb.schema !== schema) continue;
    cols.push(
      `  FOREIGN KEY ("${name}") REFERENCES "${target.duckdb.schema}"."${target.duckdb.table}" ("${refCol}")`,
    );
  }

  void entityName;
  return `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (\n${cols.join(",\n")}\n)`;
}

function mapType(col: Column): string {
  switch (col.type) {
    case "uuid":
      return "UUID";
    case "email":
    case "full_name":
    case "product_name":
    case "sku":
    case "phone":
    case "address":
      return col.max_length ? `VARCHAR(${col.max_length})` : "VARCHAR";
    case "text":
      return col.max_length ? `VARCHAR(${col.max_length})` : "VARCHAR";
    case "decimal":
      return "DECIMAL(12, 2)";
    case "int":
      return "INTEGER";
    case "timestamp":
      return "TIMESTAMP WITH TIME ZONE";
    case "boolean":
      return "BOOLEAN";
    case "enum":
      return "VARCHAR(64)";
    case "json":
      return "JSON";
    case "array_of":
      return "JSON";
    case "ref":
      return "UUID";
    default:
      return "VARCHAR";
  }
}

async function insertEntity(
  conn: DuckdbConnection,
  entity: {
    duckdb?: { schema: string; table: string };
    columns: Record<string, Column>;
  },
  data: Record<string, unknown>[],
): Promise<void> {
  if (!entity.duckdb || data.length === 0) return;
  const colNames = Object.keys(entity.columns);
  const quoted = colNames.map((n) => `"${n}"`).join(", ");
  const target = `"${entity.duckdb.schema}"."${entity.duckdb.table}"`;

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
        params.push(coerceForDuckdb(entity.columns[colName]!, row[colName]));
      }
    }

    // DuckDB node client doesn't support parameterized INSERT natively,
    // so we build literal VALUES.
    const values = batch
      .map((row) => {
        const vals = colNames.map((colName) => {
          const v = coerceForDuckdb(entity.columns[colName]!, row[colName]);
          return literal(v);
        });
        return `(${vals.join(", ")})`;
      })
      .join(",\n");
    await conn.run(`INSERT INTO ${target} (${quoted}) VALUES\n${values}`);
  }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
}

function coerceForDuckdb(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.type === "array_of")
    return JSON.stringify(Array.isArray(v) ? v : [v]);
  if (col.type === "json") return JSON.stringify(v);
  return v;
}
