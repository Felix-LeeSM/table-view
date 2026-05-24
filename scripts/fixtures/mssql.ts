// MSSQL dialect — uses `mssql` (tedious) npm package.
// Mirrors `postgres.ts` export shape: envConn, ensure, drop, isPopulated, apply.
import sql from "mssql";
import type { BaseSpec, Column, ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";

export interface MssqlConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function mssqlEnvConn(): MssqlConnection {
  return {
    host: process.env.MSSQL_HOST ?? "localhost",
    port: Number(process.env.MSSQL_PORT ?? 14333),
    user: process.env.MSSQL_USER ?? "sa",
    password: process.env.MSSQL_PASSWORD ?? "Testpass123!",
    database: "master",
  };
}

async function withPool<T>(
  conn: MssqlConnection,
  database: string | undefined,
  fn: (pool: sql.ConnectionPool) => Promise<T>,
): Promise<T> {
  const pool = await sql.connect({
    server: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    database: database ?? conn.database,
    options: {
      trustServerCertificate: true,
      encrypt: false,
    },
  });
  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

export async function ensureMssqlDatabase(
  conn: MssqlConnection,
  dbName: string,
): Promise<void> {
  await withPool(conn, undefined, async (pool) => {
    const result = await pool
      .request()
      .input("name", sql.NVarChar, dbName)
      .query(`SELECT 1 FROM sys.databases WHERE name = @name`);
    if (result.recordset.length === 0) {
      await pool
        .request()
        .query(`CREATE DATABASE [${dbName.replace(/]/g, "]]")}]`);
    }
  });
}

export async function dropMssqlDatabase(
  conn: MssqlConnection,
  dbName: string,
): Promise<void> {
  await withPool(conn, undefined, async (pool) => {
    const quoted = `[${dbName.replace(/]/g, "]]")}]`;
    await pool
      .request()
      .input("name", sql.NVarChar, dbName)
      .query(
        `IF DB_ID(@name) IS NOT NULL ALTER DATABASE ${quoted} SET SINGLE_USER WITH ROLLBACK IMMEDIATE`,
      );
    await pool
      .request()
      .input("name", sql.NVarChar, dbName)
      .query(`IF DB_ID(@name) IS NOT NULL DROP DATABASE ${quoted}`);
  });
}

export async function mssqlIsPopulated(
  conn: MssqlConnection,
  dbName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("mssql"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.mssql) return false;
  try {
    return await withPool(conn, dbName, async (pool) => {
      const result = await pool
        .request()
        .query(
          `SELECT TOP 1 1 FROM [${entity.mssql!.schema}].[${entity.mssql!.table}]`,
        );
      return result.recordset.length > 0;
    });
  } catch {
    return false;
  }
}

export async function applyMssql(
  conn: MssqlConnection,
  dbName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  await withPool(conn, dbName, async (pool) => {
    await migrateSchemas(pool, spec.base);

    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity || !entity.mssql || !entity.targets.includes("mssql"))
        continue;
      const data = rows[entityName] ?? [];
      const start = Date.now();
      await insertEntity(pool, entity, data);
      log(entityName, data.length, Date.now() - start);
    }
  });
}

async function migrateSchemas(
  pool: sql.ConnectionPool,
  base: BaseSpec,
): Promise<void> {
  const schemas = new Set<string>();
  for (const entity of Object.values(base.entities)) {
    if (entity.mssql && entity.targets.includes("mssql"))
      schemas.add(entity.mssql.schema);
  }
  for (const s of schemas) {
    await pool
      .request()
      .query(
        `IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = '${s.replace(/'/g, "''")}') EXEC('CREATE SCHEMA [${s.replace(/]/g, "]]")}]')`,
      );
  }

  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.mssql || !entity.targets.includes("mssql")) continue;
    const ddl = buildCreateTable(
      name,
      entity.mssql.schema,
      entity.mssql.table,
      entity.columns,
    );
    await pool.request().query(ddl);
  }

  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.mssql || !entity.targets.includes("mssql")) continue;
    for (const [colName, col] of Object.entries(entity.columns)) {
      if (col.type !== "ref" || !col.to) continue;
      const [refEntity, refCol] = col.to.split(".");
      if (!refEntity || !refCol) continue;
      const target = base.entities[refEntity];
      if (!target?.mssql || !target.targets.includes("mssql")) continue;
      const cName = `fk_${entity.mssql.table}_${colName}`;
      try {
        await pool
          .request()
          .query(
            `ALTER TABLE [${entity.mssql.schema}].[${entity.mssql.table}] ADD CONSTRAINT [${cName}] FOREIGN KEY ([${colName}]) REFERENCES [${target.mssql.schema}].[${target.mssql.table}] ([${refCol}])`,
          );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists/i.test(msg) && !/already a constraint/i.test(msg))
          throw err;
      }
    }
    void name;
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
    if (col.primary) primaryKeys.push(`[${name}]`);
    else if (col.nullable !== true) constraints.push("NOT NULL");
    if (col.unique && !col.primary) uniqueCols.push(`[${name}]`);
    cols.push(
      `  [${name}] ${sqlType}${constraints.length ? " " + constraints.join(" ") : ""}`,
    );
  }
  if (primaryKeys.length > 0)
    cols.push(`  PRIMARY KEY (${primaryKeys.join(", ")})`);
  for (const u of uniqueCols) cols.push(`  UNIQUE (${u})`);

  void entityName;
  return `IF OBJECT_ID(N'${schema}.${table}', N'U') IS NULL CREATE TABLE [${schema}].[${table}] (\n${cols.join(",\n")}\n)`;
}

function mapType(col: Column): string {
  switch (col.type) {
    case "uuid":
      return "UNIQUEIDENTIFIER";
    case "email":
    case "full_name":
    case "product_name":
    case "sku":
    case "phone":
    case "address":
      return col.max_length ? `NVARCHAR(${col.max_length})` : "NVARCHAR(255)";
    case "text":
      return col.max_length ? `NVARCHAR(${col.max_length})` : "NVARCHAR(MAX)";
    case "decimal":
      return "DECIMAL(12, 2)";
    case "int":
      return "INT";
    case "timestamp":
      return "DATETIME2";
    case "boolean":
      return "BIT";
    case "enum":
      return "NVARCHAR(64)";
    case "json":
      return "NVARCHAR(MAX)";
    case "array_of":
      return "NVARCHAR(MAX)";
    case "ref":
      return "UNIQUEIDENTIFIER";
    default:
      return "NVARCHAR(MAX)";
  }
}

async function insertEntity(
  pool: sql.ConnectionPool,
  entity: {
    mssql?: { schema: string; table: string };
    columns: Record<string, Column>;
  },
  data: Record<string, unknown>[],
): Promise<void> {
  if (!entity.mssql || data.length === 0) return;
  const colNames = Object.keys(entity.columns);
  const quoted = colNames.map((n) => `[${n}]`).join(", ");
  const target = `[${entity.mssql.schema}].[${entity.mssql.table}]`;

  const batchSize = 500;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const values = batch
      .map((row) => {
        const vals = colNames.map((colName) => {
          const v = coerceForMssql(entity.columns[colName]!, row[colName]);
          return literal(v);
        });
        return `(${vals.join(", ")})`;
      })
      .join(",\n");
    await pool
      .request()
      .query(`INSERT INTO ${target} (${quoted}) VALUES\n${values}`);
  }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `N'${v.replace(/'/g, "''")}'`;
  return `N'${JSON.stringify(v).replace(/'/g, "''")}'`;
}

function coerceForMssql(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.type === "array_of")
    return JSON.stringify(Array.isArray(v) ? v : [v]);
  if (col.type === "json") return JSON.stringify(v);
  if (col.type === "boolean") return v ? 1 : 0;
  return v;
}
