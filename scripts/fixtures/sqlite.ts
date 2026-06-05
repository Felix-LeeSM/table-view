// SQLite dialect — file-based fixture generator.
// Mirrors `postgres.ts` export shape: envPath, ensure, drop, isPopulated, apply.
// Uses `better-sqlite3` synchronous API for simplicity.
import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { BaseSpec, Column, ResolvedSpec } from "./spec.js";
import type { EntityRows } from "./generator.js";
import { entityOrder } from "./spec.js";
import { defaultFileFixtureDir } from "./paths.js";

export interface SqliteFixturePath {
  directory: string;
  fileName: string;
}

export function sqliteEnvPath(): SqliteFixturePath {
  return {
    directory: process.env.SQLITE_FIXTURE_DIR ?? defaultFixtureDir(),
    fileName: "",
  };
}

function defaultFixtureDir(): string {
  return defaultFileFixtureDir("sqlite");
}

function resolveDbPath(path: SqliteFixturePath, fileName: string): string {
  return resolve(path.directory, fileName);
}

function withDb<T>(
  dbPath: string,
  fn: (db: Database.Database) => T,
  options?: { readOnly?: boolean; create?: boolean },
): T {
  if (!options?.create && !existsSync(dbPath)) {
    throw new Error(`SQLite file not found: ${dbPath}`);
  }
  const db = new Database(dbPath, {
    readonly: options?.readOnly === true,
    fileMustExist: options?.create !== true,
  });
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return fn(db);
  } finally {
    db.close();
  }
}

export async function ensureSqliteDatabase(
  path: SqliteFixturePath,
  fileName: string,
): Promise<void> {
  const dbPath = resolveDbPath(path, fileName);
  mkdirSync(dirname(dbPath), { recursive: true });
  if (!existsSync(dbPath)) {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.close();
  }
}

export async function dropSqliteDatabase(
  path: SqliteFixturePath,
  fileName: string,
): Promise<void> {
  const dbPath = resolveDbPath(path, fileName);
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
    const walPath = `${dbPath}-wal`;
    const shmPath = `${dbPath}-shm`;
    if (existsSync(walPath)) unlinkSync(walPath);
    if (existsSync(shmPath)) unlinkSync(shmPath);
  }
}

export async function sqliteIsPopulated(
  path: SqliteFixturePath,
  fileName: string,
  spec: ResolvedSpec,
): Promise<boolean> {
  const dbPath = resolveDbPath(path, fileName);
  if (!existsSync(dbPath)) return false;
  const first = entityOrder(spec.base).find((n) =>
    spec.base.entities[n]?.targets.includes("sqlite"),
  );
  if (!first) return false;
  const entity = spec.base.entities[first];
  if (!entity?.sqlite) return false;
  return withDb(
    dbPath,
    (db) => {
      try {
        const row = db
          .prepare(`SELECT 1 FROM [${entity.sqlite!.table}] LIMIT 1`)
          .get();
        return row !== undefined;
      } catch {
        return false;
      }
    },
    { readOnly: true, create: false },
  );
}

export async function applySqlite(
  path: SqliteFixturePath,
  fileName: string,
  spec: ResolvedSpec,
  rows: EntityRows,
  log: (entity: string, count: number, ms: number) => void,
): Promise<void> {
  const dbPath = resolveDbPath(path, fileName);
  mkdirSync(dirname(dbPath), { recursive: true });

  withDb(
    dbPath,
    (db) => {
      migrateSchemas(db, spec.base);

      for (const entityName of entityOrder(spec.base)) {
        const entity = spec.base.entities[entityName];
        if (!entity || !entity.sqlite || !entity.targets.includes("sqlite"))
          continue;
        const data = rows[entityName] ?? [];
        const start = Date.now();
        insertEntity(db, entity, data);
        log(entityName, data.length, Date.now() - start);
      }
    },
    { create: true },
  );
}

function migrateSchemas(db: Database.Database, base: BaseSpec): void {
  for (const [name, entity] of Object.entries(base.entities)) {
    if (!entity.sqlite || !entity.targets.includes("sqlite")) continue;
    const ddl = buildCreateTable(
      name,
      entity.sqlite.table,
      entity.columns,
      base,
    );
    db.exec(ddl);
  }
}

function buildCreateTable(
  entityName: string,
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
    if (col.primary) primaryKeys.push(`[${name}]`);
    else if (col.nullable !== true) constraints.push("NOT NULL");
    if (shouldApplyLengthCheck(col)) {
      constraints.push(`CHECK(length([${name}]) <= ${col.max_length})`);
    }
    if (col.unique && !col.primary) uniqueCols.push(`[${name}]`);
    cols.push(
      `  [${name}] ${sqlType}${constraints.length ? " " + constraints.join(" ") : ""}`,
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
    if (!target?.sqlite || !target.targets.includes("sqlite")) continue;
    cols.push(
      `  FOREIGN KEY ([${name}]) REFERENCES [${target.sqlite.table}] ([${refCol}])`,
    );
  }

  void entityName;
  return `CREATE TABLE IF NOT EXISTS [${table}] (\n${cols.join(",\n")}\n)`;
}

function mapType(col: Column): string {
  switch (col.type) {
    case "uuid":
      return "TEXT";
    case "email":
    case "full_name":
    case "product_name":
    case "sku":
    case "phone":
    case "address":
      return "TEXT";
    case "text":
      return "TEXT";
    case "decimal":
      return "NUMERIC";
    case "int":
      return "INTEGER";
    case "timestamp":
      return "TEXT";
    case "boolean":
      return "INTEGER";
    case "enum":
      return "TEXT";
    case "json":
      return "TEXT";
    case "array_of":
      return "TEXT";
    case "ref":
      return "TEXT";
    default:
      return "TEXT";
  }
}

function shouldApplyLengthCheck(col: Column): boolean {
  return (
    col.max_length !== undefined &&
    [
      "email",
      "full_name",
      "product_name",
      "sku",
      "phone",
      "address",
      "text",
    ].includes(col.type)
  );
}

function insertEntity(
  db: Database.Database,
  entity: {
    sqlite?: { table: string };
    columns: Record<string, Column>;
  },
  data: Record<string, unknown>[],
): void {
  if (!entity.sqlite || data.length === 0) return;
  const colNames = Object.keys(entity.columns);
  const quoted = colNames.map((n) => `[${n}]`).join(", ");
  const target = `[${entity.sqlite.table}]`;
  const placeholders = colNames.map(() => "?").join(", ");

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO ${target} (${quoted}) VALUES (${placeholders})`,
  );

  const batchSize = 500;
  const insertBatch = db.transaction((batch: Record<string, unknown>[]) => {
    for (const row of batch) {
      const params = colNames.map((colName) =>
        coerceForSqlite(entity.columns[colName]!, row[colName]),
      );
      stmt.run(...params);
    }
  });

  for (let i = 0; i < data.length; i += batchSize) {
    insertBatch(data.slice(i, i + batchSize));
  }
}

function coerceForSqlite(col: Column, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (col.type === "array_of")
    return JSON.stringify(Array.isArray(v) ? v : [v]);
  if (col.type === "json") return JSON.stringify(v);
  if (col.type === "boolean") return v ? 1 : 0;
  return v;
}
