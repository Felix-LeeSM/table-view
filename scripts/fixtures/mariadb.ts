// MariaDB dialect — reuses mysql2 driver with separate env vars.
// MariaDB shares the MySQL protocol but keeps a separate fixture generator
// so feature slices can add MariaDB-specific DDL or type cases independently.
import { createConnection, type Connection } from "mysql2/promise";
import type { BaseSpec, Column, ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";

export interface MariadbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
}

export function mariadbEnvConn(): MariadbConnection {
  return {
    host: process.env.MARIADB_HOST ?? "localhost",
    port: Number(process.env.MARIADB_PORT ?? 23306),
    user: process.env.MARIADB_USER ?? "testuser",
    password: process.env.MARIADB_PASSWORD ?? "testpass",
  };
}

export function mariadbRootEnvConn(): MariadbConnection {
  return {
    host: process.env.MARIADB_HOST ?? "localhost",
    port: Number(process.env.MARIADB_PORT ?? 23306),
    user: "root",
    password: process.env.MARIADB_ROOT_PASSWORD ?? "testroot",
  };
}

async function withClient<T>(
  conn: MariadbConnection,
  database: string | null,
  fn: (c: Connection) => Promise<T>,
): Promise<T> {
  const client = await createConnection({
    host: conn.host,
    port: conn.port,
    user: conn.user,
    password: conn.password,
    ...(database !== null ? { database } : {}),
    multipleStatements: false,
  });
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function ensureMariadbDatabaseAndGrant(
  rootConn: MariadbConnection,
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

export async function dropMariadbDatabase(
  conn: MariadbConnection,
  dbName: string,
): Promise<void> {
  await withClient(conn, null, async (c) => {
    const quoted = "`" + dbName.replace(/`/g, "``") + "`";
    await c.query(`DROP DATABASE IF EXISTS ${quoted}`);
  });
}

export async function mariadbIsPopulated(
  conn: MariadbConnection,
  dbName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("mariadb"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.mariadb) return false;
  return withClient(conn, dbName, async (c) => {
    try {
      const quoted = "`" + entity.mariadb!.table.replace(/`/g, "``") + "`";
      const [rows] = await c.query(`SELECT 1 FROM ${quoted} LIMIT 1`);
      return Array.isArray(rows) && rows.length > 0;
    } catch {
      return false;
    }
  });
}

export async function applyMariadb(
  conn: MariadbConnection,
  dbName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  await withClient(conn, dbName, async (c) => {
    await migrateSchemas(c, spec.base);
    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity || !entity.mariadb || !entity.targets.includes("mariadb"))
        continue;
      const data = rows[entityName] ?? [];
      const start = Date.now();
      await insertEntity(c, entity, data);
      log(entityName, data.length, Date.now() - start);
    }
  });
}

async function migrateSchemas(c: Connection, base: BaseSpec): Promise<void> {
  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.mariadb || !entity.targets.includes("mariadb")) continue;
    const ddl = buildCreateTable(name, entity.mariadb.table, entity.columns);
    await c.query(ddl);
  }
  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.mariadb || !entity.targets.includes("mariadb")) continue;
    for (const [colName, col] of Object.entries(entity.columns)) {
      if (col.type !== "ref" || !col.to) continue;
      const [refEntity, refCol] = col.to.split(".");
      if (!refEntity || !refCol) continue;
      const target = base.entities[refEntity];
      if (!target?.mariadb || !target.targets.includes("mariadb")) continue;
      const cName = `fk_${entity.mariadb.table}_${colName}`;
      const quotedTable = "`" + entity.mariadb.table.replace(/`/g, "``") + "`";
      const quotedCol = "`" + colName.replace(/`/g, "``") + "`";
      const quotedConstraint = "`" + cName.replace(/`/g, "``") + "`";
      const quotedRefTable =
        "`" + target.mariadb.table.replace(/`/g, "``") + "`";
      const quotedRefCol = "`" + refCol.replace(/`/g, "``") + "`";
      try {
        await c.query(
          `ALTER TABLE ${quotedTable} ADD CONSTRAINT ${quotedConstraint} FOREIGN KEY (${quotedCol}) REFERENCES ${quotedRefTable} (${quotedRefCol})`,
        );
      } catch (err: unknown) {
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
      return col.max_length ? `VARCHAR(${col.max_length})` : "VARCHAR(255)";
    case "text":
      return col.max_length ? `VARCHAR(${col.max_length})` : "TEXT";
    case "decimal":
      return "DECIMAL(12, 2)";
    case "int":
      return "INT";
    case "timestamp":
      return "DATETIME(6)";
    case "boolean":
      return "TINYINT(1)";
    case "enum":
      return "VARCHAR(64)";
    case "json":
      return "JSON";
    case "array_of":
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
    mariadb?: { table: string };
    columns: Record<string, Column>;
  },
  data: Record<string, unknown>[],
): Promise<void> {
  if (!entity.mariadb || data.length === 0) return;
  const colNames = Object.keys(entity.columns);
  const quoted = colNames
    .map((n) => "`" + n.replace(/`/g, "``") + "`")
    .join(", ");
  const target = "`" + entity.mariadb.table.replace(/`/g, "``") + "`";

  const batchSize = 500;
  for (let i = 0; i < data.length; i += batchSize) {
    const batch = data.slice(i, i + batchSize);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    for (const row of batch) {
      const slot = colNames.map(() => "?").join(", ");
      placeholders.push(`(${slot})`);
      for (const colName of colNames) {
        params.push(coerceForMariadb(entity.columns[colName]!, row[colName]));
      }
    }
    await c.query(
      `INSERT INTO ${target} (${quoted}) VALUES ${placeholders.join(", ")}`,
      params,
    );
  }
}

function coerceForMariadb(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.type === "array_of")
    return JSON.stringify(Array.isArray(v) ? v : [v]);
  if (col.type === "json") return JSON.stringify(v);
  if (col.type === "timestamp" && v instanceof Date) {
    const iso = v.toISOString();
    return iso.replace("T", " ").replace("Z", "");
  }
  if (col.type === "timestamp" && typeof v === "string") {
    return v.replace("T", " ").replace(/Z$|[+-]\d\d:?\d\d$/, "");
  }
  if (col.type === "boolean") return v ? 1 : 0;
  return v;
}
