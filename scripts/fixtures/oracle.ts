// Oracle dialect — uses `oracledb` thin mode (pure JS, no Instant Client).
// Mirrors `postgres.ts` export shape: envConn, ensure, drop, isPopulated, apply.
import oracledb from "oracledb";
import type { BaseSpec, Column, ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";

export interface OracleConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  serviceName: string;
}

export function oracleEnvConn(): OracleConnection {
  return {
    host: process.env.ORACLE_HOST ?? "localhost",
    port: Number(process.env.ORACLE_PORT ?? 1521),
    user: process.env.ORACLE_USER ?? "testuser",
    password: process.env.ORACLE_PASSWORD ?? "testpass",
    serviceName: process.env.ORACLE_SERVICE ?? "XEPDB1",
  };
}

function connectString(conn: OracleConnection): string {
  return `${conn.host}:${conn.port}/${conn.serviceName}`;
}

async function withConnection<T>(
  conn: OracleConnection,
  fn: (c: oracledb.Connection) => Promise<T>,
): Promise<void> {
  const connection = await oracledb.getConnection({
    user: conn.user,
    password: conn.password,
    connectString: connectString(conn),
  });
  try {
    await fn(connection);
    await connection.commit();
  } catch (err) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback error
    }
    throw err;
  } finally {
    await connection.close();
  }
}

// Oracle doesn't have CREATE DATABASE — the connected user owns the schema.
// ensure/drop are no-ops that verify connectivity.
export async function ensureOracleSchema(
  conn: OracleConnection,
  _dbName: string,
): Promise<void> {
  void _dbName;
  await withConnection(conn, async () => {});
}

export async function dropOracleTables(
  conn: OracleConnection,
  _dbName: string,
  spec: ResolvedSpec,
): Promise<void> {
  await withConnection(conn, async (c) => {
    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity?.oracle || !entity.targets.includes("oracle")) continue;
      try {
        await c.execute(
          `BEGIN EXECUTE IMMEDIATE 'DROP TABLE ${entity.oracle.table} CASCADE CONSTRAINTS'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`,
        );
      } catch {
        // ignore
      }
    }
  });
}

export async function oracleIsPopulated(
  conn: OracleConnection,
  _dbName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("oracle"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.oracle) return false;
  try {
    let populated = false;
    await withConnection(conn, async (c) => {
      const result = await c.execute(
        `SELECT 1 FROM ${entity.oracle!.table} WHERE ROWNUM = 1`,
      );
      populated = (result.rows?.length ?? 0) > 0;
    });
    return populated;
  } catch {
    return false;
  }
}

export async function applyOracle(
  conn: OracleConnection,
  _dbName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  await withConnection(conn, async (c) => {
    await migrateSchemas(c, spec.base);

    for (const entityName of entityOrder(spec.base)) {
      const entity = spec.base.entities[entityName];
      if (!entity || !entity.oracle || !entity.targets.includes("oracle"))
        continue;
      const data = rows[entityName] ?? [];
      const start = Date.now();
      await insertEntity(c, entity, data);
      log(entityName, data.length, Date.now() - start);
    }
  });
}

async function migrateSchemas(
  c: oracledb.Connection,
  base: BaseSpec,
): Promise<void> {
  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.oracle || !entity.targets.includes("oracle")) continue;
    const ddl = buildCreateTable(name, entity.oracle.table, entity.columns);
    try {
      await c.execute(
        `BEGIN EXECUTE IMMEDIATE '${ddl.replace(/'/g, "''")}'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -955 THEN RAISE; END IF; END;`,
      );
    } catch (err) {
      // If PL/SQL block fails, try direct DDL
      if (err instanceof Error && !/ORA-00955/.test(err.message)) throw err;
    }
  }

  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.oracle || !entity.targets.includes("oracle")) continue;
    for (const [colName, col] of Object.entries(entity.columns)) {
      if (col.type !== "ref" || !col.to) continue;
      const [refEntity, refCol] = col.to.split(".");
      if (!refEntity || !refCol) continue;
      const target = base.entities[refEntity];
      if (!target?.oracle || !target.targets.includes("oracle")) continue;
      const cName = `FK_${entity.oracle.table}_${colName}`;
      try {
        await c.execute(
          `ALTER TABLE ${entity.oracle.table} ADD CONSTRAINT ${cName} FOREIGN KEY (${colName}) REFERENCES ${target.oracle.table} (${refCol})`,
        );
      } catch (err) {
        if (
          err instanceof Error &&
          !/ORA-02260/.test(err.message) &&
          !/already exists/i.test(err.message)
        )
          throw err;
      }
    }
    void name;
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
    if (col.primary) primaryKeys.push(name);
    else if (col.nullable !== true) constraints.push("NOT NULL");
    if (col.unique && !col.primary) uniqueCols.push(name);
    cols.push(
      `${name} ${sqlType}${constraints.length ? " " + constraints.join(" ") : ""}`,
    );
  }
  if (primaryKeys.length > 0)
    cols.push(`PRIMARY KEY (${primaryKeys.join(", ")})`);
  for (const u of uniqueCols) cols.push(`UNIQUE (${u})`);

  void entityName;
  return `CREATE TABLE ${table} (${cols.join(", ")})`;
}

function mapType(col: Column): string {
  switch (col.type) {
    case "uuid":
      return "VARCHAR2(36)";
    case "email":
    case "full_name":
    case "product_name":
    case "sku":
    case "phone":
    case "address":
      return varcharOrClob(col.max_length, 255);
    case "text":
      return varcharOrClob(col.max_length, 4000);
    case "decimal":
      return "NUMBER(12, 2)";
    case "int":
      return "NUMBER(10)";
    case "timestamp":
      return "TIMESTAMP WITH TIME ZONE";
    case "boolean":
      return "NUMBER(1)";
    case "enum":
      return "VARCHAR2(64)";
    case "json":
      return "CLOB";
    case "array_of":
      return "CLOB";
    case "ref":
      return "VARCHAR2(36)";
    default:
      return "VARCHAR2(4000)";
  }
}

function varcharOrClob(
  maxLength: number | undefined,
  defaultLength: number,
): string {
  const length = maxLength ?? defaultLength;
  return length > 4000 ? "CLOB" : `VARCHAR2(${length})`;
}

async function insertEntity(
  c: oracledb.Connection,
  entity: {
    oracle?: { table: string };
    columns: Record<string, Column>;
  },
  data: Record<string, unknown>[],
): Promise<void> {
  if (!entity.oracle || data.length === 0) return;
  const colNames = Object.keys(entity.columns);
  const table = entity.oracle.table;

  for (const row of data) {
    const cols = colNames.join(", ");
    const vals = colNames.map((colName) => {
      const v = coerceForOracle(entity.columns[colName]!, row[colName]);
      return literal(v);
    });

    // Use MERGE for idempotency on PK
    const pkCol = Object.entries(entity.columns).find(
      ([, col]) => col.primary,
    )?.[0];
    if (pkCol) {
      const pkVal = literal(
        coerceForOracle(entity.columns[pkCol]!, row[pkCol]),
      );
      await c.execute(
        `MERGE INTO ${table} t USING (SELECT ${pkVal} AS ${pkCol} FROM dual) s ON (t.${pkCol} = s.${pkCol}) WHEN NOT MATCHED THEN INSERT (${cols}) VALUES (${vals.join(", ")})`,
      );
    } else {
      await c.execute(
        `INSERT INTO ${table} (${cols}) VALUES (${vals.join(", ")})`,
      );
    }
  }
}

function literal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "string") return stringLiteral(v);
  return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
}

function stringLiteral(value: string): string {
  const chunkSize = 3900;
  if (value.length <= chunkSize) return `'${value.replace(/'/g, "''")}'`;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(
      `TO_CLOB('${value.slice(i, i + chunkSize).replace(/'/g, "''")}')`,
    );
  }
  return chunks.join(" || ");
}

function coerceForOracle(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.type === "array_of")
    return JSON.stringify(Array.isArray(v) ? v : [v]);
  if (col.type === "json") return JSON.stringify(v);
  if (col.type === "boolean") return v ? 1 : 0;
  return v;
}

export const __testing = {
  buildCreateTable,
  mapType,
};
