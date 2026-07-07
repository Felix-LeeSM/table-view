import duckdb, {
  type Connection as NativeDuckdbConnection,
  type Database as NativeDuckdbDatabase,
} from "duckdb";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

export async function prepareDuckdbFixture(
  path: string,
  seedRelativePath = "e2e/fixtures/duckdb/query/seed.sql",
) {
  mkdirSync(dirname(path), { recursive: true });
  rmSync(path, { force: true });
  rmSync(`${path}.wal`, { force: true });

  const sql = readFileSync(resolve(seedRelativePath), "utf-8");
  const database = new duckdb.Database(path);
  const connection = database.connect();

  try {
    for (const statement of splitSqlStatements(sql)) {
      await runDuckdb(connection, statement);
    }
  } finally {
    await closeDuckdb(connection, database);
  }
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function runDuckdb(
  connection: NativeDuckdbConnection,
  sql: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    connection.run(sql, (err) => {
      if (err) reject(new Error(err.message ?? String(err)));
      else resolve();
    });
  });
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
