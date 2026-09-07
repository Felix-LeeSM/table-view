import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { DatabaseType } from "./model";
import { connectTimeoutMaxSecs, SUPPORTED_DATABASE_TYPES } from "./model";

// Issue #2610 — `connectTimeoutMaxSecs` is a hand-written mirror of the
// per-driver timeout ceilings under `src-tauri/table-view-core/src/db/`. Until
// now the mirror was held only by a JSDoc list of const names in `model.ts`,
// so a backend ceiling that moved (the #2444 redis 300→30 precedent) left the
// UI advertising a bound the dial no longer honours — the quiet-truncation
// direction. These tests read the const out of the Rust source and diff it
// against the mirror, so the drift fails here instead of on a user's screen.
//
// The sweep tests keep the table complete: a ceiling const added or renamed
// in `db/` and an engine added to `SUPPORTED_DATABASE_TYPES` both land here
// as a red telling the author to mirror them, rather than silently joining
// the unguarded set. duckdb is the one engine with no ceiling to mirror —
// the backend reads no timeout at all there — so it is exempt from the
// coverage test, and a duckdb ceiling would surface through the sweep.

/** Repo-relative Rust files that declare a timeout ceiling, and the engines
 * each one serves. `dbTypes` follows the adapter routing: mariadb dials
 * through the MySQL adapter, valkey through the Redis one, and both search
 * engines through `search_http`. */
const CEILING_SOURCES: readonly {
  readonly path: string;
  readonly constName: string;
  readonly dbTypes: readonly DatabaseType[];
}[] = [
  {
    path: "src-tauri/table-view-core/src/db/mssql.rs",
    constName: "MAX_CONNECTION_TIMEOUT_SECS",
    dbTypes: ["mssql"],
  },
  {
    path: "src-tauri/table-view-core/src/db/mongodb/connection.rs",
    constName: "MONGO_CONNECT_TIMEOUT_MAX_SECS",
    dbTypes: ["mongodb"],
  },
  {
    path: "src-tauri/table-view-core/src/db/search_http.rs",
    constName: "SEARCH_HTTP_TIMEOUT_MAX_SECS",
    dbTypes: ["elasticsearch", "opensearch"],
  },
  {
    path: "src-tauri/table-view-core/src/db/postgres/connection.rs",
    constName: "PG_POOL_ACQUIRE_TIMEOUT_MAX_SECS",
    dbTypes: ["postgresql"],
  },
  {
    path: "src-tauri/table-view-core/src/db/mysql/connection.rs",
    constName: "MYSQL_POOL_ACQUIRE_TIMEOUT_MAX_SECS",
    dbTypes: ["mysql", "mariadb"],
  },
  {
    path: "src-tauri/table-view-core/src/db/oracle.rs",
    constName: "ORACLE_CONNECT_TIMEOUT_MAX_SECS",
    dbTypes: ["oracle"],
  },
  {
    path: "src-tauri/table-view-core/src/db/redis/helpers.rs",
    constName: "REDIS_CONNECT_TIMEOUT_MAX_SECS",
    dbTypes: ["redis", "valkey"],
  },
  {
    path: "src-tauri/table-view-core/src/db/adapters/sqlite/connection.rs",
    constName: "SQLITE_POOL_ACQUIRE_TIMEOUT_MAX_SECS",
    dbTypes: ["sqlite"],
  },
];

/** The one engine whose backend reads `connectionTimeout` not at all —
 * nothing to mirror. */
const UNMIRRORED_DATABASE_TYPES: readonly DatabaseType[] = ["duckdb"];

const REPO_ROOT = process.cwd();
const DB_ROOT = resolve(REPO_ROOT, "src-tauri/table-view-core/src/db");

/** `const NAME: uN = 300;` — the declaration form. Doc-comment mentions of a
 * const name carry no `: uN = literal;` tail, so they never match. */
function ceilingDeclaration(constName: string): RegExp {
  return new RegExp(`\\bconst ${constName}\\s*:\\s*u\\d+\\s*=\\s*(\\d+)\\s*;`);
}

function backendCeiling(path: string, constName: string): number {
  const source = readFileSync(resolve(REPO_ROOT, path), "utf8");
  const match = ceilingDeclaration(constName).exec(source);
  if (!match) {
    throw new Error(
      `no \`const ${constName}: uN = <secs>;\` declaration found in ${path} — ` +
        "the const was renamed or moved; update CEILING_SOURCES",
    );
  }
  return Number(match[1]);
}

/** Every `const ...TIMEOUT...MAX...SECS: uN = <literal>;` declaration in
 * `db/`, mirrored or not. Defaults (`*_DEFAULT_SECS`, the shared
 * `CONNECT_TIMEOUT_DEFAULT_SECS`) and the Oracle test-probe timeout carry no
 * `MAX`, so they stay out of this population on their own. */
function backendCeilingDeclarations(): readonly {
  path: string;
  constName: string;
  secs: number;
}[] {
  const hits: { path: string; constName: string; secs: number }[] = [];
  const declaration =
    /\bconst ([A-Z0-9_]*TIMEOUT[A-Z0-9_]*)\s*:\s*u\d+\s*=\s*(\d+)\s*;/g;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
      } else if (path.endsWith(".rs")) {
        for (const match of readFileSync(path, "utf8").matchAll(declaration)) {
          const constName = match[1];
          const secs = match[2];
          if (
            constName !== undefined &&
            secs !== undefined &&
            constName.includes("MAX")
          ) {
            hits.push({
              path: path.slice(REPO_ROOT.length + 1),
              constName,
              secs: Number(secs),
            });
          }
        }
      }
    }
  };
  walk(DB_ROOT);
  return hits;
}

describe("connectTimeoutMaxSecs mirrors the backend driver ceilings (#2610)", () => {
  it("reads each named const out of the Rust source and matches the mirror", () => {
    for (const { path, constName, dbTypes } of CEILING_SOURCES) {
      const ceiling = backendCeiling(path, constName);
      for (const dbType of dbTypes) {
        expect(
          connectTimeoutMaxSecs(dbType),
          `${dbType} should mirror ${constName} in ${path}`,
        ).toBe(ceiling);
      }
    }
  });

  it("mirrors every timeout ceiling const declared under db/", () => {
    const mirrored = new Set(
      CEILING_SOURCES.map(({ path, constName }) => `${path}::${constName}`),
    );
    const unmirrored = backendCeilingDeclarations().filter(
      ({ path, constName }) => !mirrored.has(`${path}::${constName}`),
    );
    expect(
      unmirrored,
      "new backend ceiling(s) not mirrored by connectTimeoutMaxSecs — " +
        "add them to CEILING_SOURCES with the engines they serve",
    ).toEqual([]);
  });

  it("claims exactly one ceiling source per engine that has one", () => {
    const needsMirror = SUPPORTED_DATABASE_TYPES.filter(
      (dbType) => !UNMIRRORED_DATABASE_TYPES.includes(dbType),
    );
    for (const dbType of needsMirror) {
      const claims = CEILING_SOURCES.filter((source) =>
        source.dbTypes.includes(dbType),
      ).length;
      expect(
        claims,
        `${dbType} must be claimed by exactly one CEILING_SOURCES entry`,
      ).toBe(1);
    }
  });
});
