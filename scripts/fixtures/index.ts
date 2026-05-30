#!/usr/bin/env node
// Fixture CLI entry — `tsx scripts/fixtures/index.ts <subcommand> [args]`.
// Subcommands: seed | reset | connections | generate
import { entityOrder, loadSpec } from "./spec.js";
import { generateAll } from "./generator.js";
import {
  applyPostgres,
  dropPgDatabase,
  ensurePgDatabase,
  pgEnvConn,
  pgIsPopulated,
} from "./postgres.js";
import {
  applyMongo,
  dropMongoDatabase,
  mongoEnvConn,
  mongoIsPopulated,
} from "./mongo.js";
import {
  applyMysql,
  dropMysqlDatabase,
  ensureMysqlDatabaseAndGrant,
  mysqlEnvConn,
  mysqlIsPopulated,
  mysqlRootEnvConn,
} from "./mysql.js";
import {
  applySqlite,
  dropSqliteDatabase,
  ensureSqliteDatabase,
  sqliteEnvPath,
  sqliteIsPopulated,
} from "./sqlite.js";
import {
  applyDuckdb,
  dropDuckdbDatabase,
  duckdbEnvPath,
  duckdbIsPopulated,
  ensureDuckdbDatabase,
} from "./duckdb.js";
import {
  applyMariadb,
  dropMariadbDatabase,
  ensureMariadbDatabaseAndGrant,
  mariadbEnvConn,
  mariadbIsPopulated,
  mariadbRootEnvConn,
} from "./mariadb.js";
import {
  applyMssql,
  dropMssqlDatabase,
  ensureMssqlDatabase,
  mssqlEnvConn,
  mssqlIsPopulated,
} from "./mssql.js";
import {
  applyOracle,
  dropOracleTables,
  ensureOracleSchema,
  oracleEnvConn,
  oracleIsPopulated,
} from "./oracle.js";
import {
  applyRedis,
  dropRedisDatabase,
  ensureRedisDatabase,
  redisEnvConn,
  redisIsPopulated,
} from "./redis.js";
import { clearConnections, upsertConnections } from "./connections.js";
import {
  shouldRunTarget,
  targetMode,
  type Target,
} from "./target-selection.js";

interface ParsedArgs {
  subcommand: string;
  positional: string[];
  options: Record<string, string | boolean>;
}

function parse(argv: string[]): ParsedArgs {
  const [subcommand, ...rest] = argv;
  const positional: string[] = [];
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i] ?? "";
    if (tok.startsWith("--")) {
      const [k, v] = tok.slice(2).split("=", 2);
      if (k === undefined) continue;
      if (v !== undefined) options[k] = v;
      else if (rest[i + 1] && !rest[i + 1]!.startsWith("--")) {
        options[k] = rest[++i] ?? true;
      } else {
        options[k] = true;
      }
    } else {
      positional.push(tok);
    }
  }
  return { subcommand: subcommand ?? "", positional, options };
}

function quiet(options: Record<string, string | boolean>): boolean {
  return options.quiet === true || options.quiet === "true";
}

type Counts = Record<string, number>;

async function cmdSeed(
  profile: string,
  target: Target,
  isQuiet: boolean,
): Promise<void> {
  const spec = loadSpec(profile);
  console.log(`db:seed ${profile} (target=${target})`);

  const counts: Counts = {};
  const t0 = Date.now();

  if (shouldRunTarget(target, "pg")) {
    const conn = pgEnvConn();
    await ensurePgDatabase(conn, spec.profileSpec.database.pg);
    if (await pgIsPopulated(conn, spec.profileSpec.database.pg, spec)) {
      console.log(
        `  postgres → ${spec.profileSpec.database.pg}: already seeded`,
      );
    } else {
      const rows = generateAll(spec);
      console.log(`  postgres → ${spec.profileSpec.database.pg}`);
      await applyPostgres(
        conn,
        spec.profileSpec.database.pg,
        spec,
        rows,
        (e, n, ms) => {
          if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
          counts.pg = (counts.pg ?? 0) + n;
        },
      );
    }
  }

  if (shouldRunTarget(target, "mongo")) {
    const conn = mongoEnvConn();
    if (await mongoIsPopulated(conn, spec.profileSpec.database.mongo, spec)) {
      console.log(
        `  mongodb → ${spec.profileSpec.database.mongo}: already seeded`,
      );
    } else {
      const rows = generateAll(spec);
      console.log(`  mongodb → ${spec.profileSpec.database.mongo}`);
      await applyMongo(
        conn,
        spec.profileSpec.database.mongo,
        spec,
        rows,
        (e, n, ms) => {
          if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "docs")}`);
          counts.mongo = (counts.mongo ?? 0) + n;
        },
      );
    }
  }

  if (shouldRunTarget(target, "mysql")) {
    const conn = mysqlEnvConn();
    const mysqlDb =
      spec.profileSpec.database.mysql ?? spec.profileSpec.database.pg;
    await ensureMysqlDatabaseAndGrant(mysqlRootEnvConn(), mysqlDb, conn.user);
    if (await mysqlIsPopulated(conn, mysqlDb, spec)) {
      console.log(`  mysql → ${mysqlDb}: already seeded`);
    } else {
      const rows = generateAll(spec);
      console.log(`  mysql → ${mysqlDb}`);
      await applyMysql(conn, mysqlDb, spec, rows, (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
        counts.mysql = (counts.mysql ?? 0) + n;
      });
    }
  }

  if (shouldRunTarget(target, "sqlite")) {
    const path = sqliteEnvPath();
    const file = spec.profileSpec.database.sqlite;
    if (!file) {
      if (target !== "all")
        throw new Error("profile has no sqlite database configured");
    } else {
      await ensureSqliteDatabase(path, file);
      if (await sqliteIsPopulated(path, file, spec)) {
        console.log(`  sqlite → ${file}: already seeded`);
      } else {
        const rows = generateAll(spec);
        console.log(`  sqlite → ${file}`);
        await applySqlite(path, file, spec, rows, (e, n, ms) => {
          if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
          counts.sqlite = (counts.sqlite ?? 0) + n;
        });
      }
    }
  }

  if (shouldRunTarget(target, "duckdb")) {
    const path = duckdbEnvPath();
    const file = spec.profileSpec.database.duckdb;
    if (!file) {
      if (target !== "all")
        throw new Error("profile has no duckdb database configured");
    } else {
      await ensureDuckdbDatabase(path, file);
      if (await duckdbIsPopulated(path, file, spec)) {
        console.log(`  duckdb → ${file}: already seeded`);
      } else {
        const rows = generateAll(spec);
        console.log(`  duckdb → ${file}`);
        await applyDuckdb(path, file, spec, rows, (e, n, ms) => {
          if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
          counts.duckdb = (counts.duckdb ?? 0) + n;
        });
      }
    }
  }

  if (shouldRunTarget(target, "mariadb")) {
    const conn = mariadbEnvConn();
    const db = spec.profileSpec.database.mariadb;
    if (!db) {
      throw new Error("profile has no mariadb database configured");
    } else {
      await ensureMariadbDatabaseAndGrant(mariadbRootEnvConn(), db, conn.user);
      if (await mariadbIsPopulated(conn, db, spec)) {
        console.log(`  mariadb → ${db}: already seeded`);
      } else {
        const rows = generateAll(spec);
        console.log(`  mariadb → ${db}`);
        await applyMariadb(conn, db, spec, rows, (e, n, ms) => {
          if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
          counts.mariadb = (counts.mariadb ?? 0) + n;
        });
      }
    }
  }

  if (shouldRunTarget(target, "mssql")) {
    const conn = mssqlEnvConn();
    const db = spec.profileSpec.database.mssql;
    if (!db) {
      throw new Error("profile has no mssql database configured");
    } else {
      await ensureMssqlDatabase(conn, db);
      if (await mssqlIsPopulated(conn, db, spec)) {
        console.log(`  mssql → ${db}: already seeded`);
      } else {
        const rows = generateAll(spec);
        console.log(`  mssql → ${db}`);
        await applyMssql(conn, db, spec, rows, (e, n, ms) => {
          if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
          counts.mssql = (counts.mssql ?? 0) + n;
        });
      }
    }
  }

  if (shouldRunTarget(target, "oracle")) {
    const conn = oracleEnvConn();
    const db = spec.profileSpec.database.oracle;
    if (!db) {
      throw new Error("profile has no oracle database configured");
    } else {
      await ensureOracleSchema(conn, db);
      if (await oracleIsPopulated(conn, db, spec)) {
        console.log(`  oracle → ${db}: already seeded`);
      } else {
        const rows = generateAll(spec);
        console.log(`  oracle → ${db}`);
        await applyOracle(conn, db, spec, rows, (e, n, ms) => {
          if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
          counts.oracle = (counts.oracle ?? 0) + n;
        });
      }
    }
  }

  if (shouldRunTarget(target, "redis")) {
    const dbNum = spec.profileSpec.database.redis ?? 0;
    const conn = redisEnvConn(dbNum);
    await ensureRedisDatabase(conn);
    if (await redisIsPopulated(conn, spec)) {
      console.log(`  redis → db${dbNum}: already seeded`);
    } else {
      const rows = generateAll(spec);
      console.log(`  redis → db${dbNum}`);
      await applyRedis(conn, spec, rows, (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "keys")}`);
        counts.redis = (counts.redis ?? 0) + n;
      });
    }
  }

  const summary = Object.entries(counts)
    .map(([k, v]) => `${v.toLocaleString()} ${k}`)
    .join(" + ");
  console.log(
    `done — ${summary || "nothing to seed"} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

async function cmdReset(
  profile: string,
  target: Target,
  isQuiet: boolean,
): Promise<void> {
  const spec = loadSpec(profile);
  console.log(`db:reset ${profile} (target=${target})`);

  const counts: Counts = {};
  const t0 = Date.now();

  if (shouldRunTarget(target, "pg")) {
    const conn = pgEnvConn();
    await dropPgDatabase(conn, spec.profileSpec.database.pg);
    await ensurePgDatabase(conn, spec.profileSpec.database.pg);
    const rows = generateAll(spec);
    console.log(`  postgres → ${spec.profileSpec.database.pg}`);
    await applyPostgres(
      conn,
      spec.profileSpec.database.pg,
      spec,
      rows,
      (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
        counts.pg = (counts.pg ?? 0) + n;
      },
    );
  }

  if (shouldRunTarget(target, "mongo")) {
    const conn = mongoEnvConn();
    await dropMongoDatabase(conn, spec.profileSpec.database.mongo);
    const rows = generateAll(spec);
    console.log(`  mongodb → ${spec.profileSpec.database.mongo}`);
    await applyMongo(
      conn,
      spec.profileSpec.database.mongo,
      spec,
      rows,
      (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "docs")}`);
        counts.mongo = (counts.mongo ?? 0) + n;
      },
    );
  }

  if (shouldRunTarget(target, "mysql")) {
    const conn = mysqlEnvConn();
    const mysqlDb =
      spec.profileSpec.database.mysql ?? spec.profileSpec.database.pg;
    await dropMysqlDatabase(mysqlRootEnvConn(), mysqlDb);
    await ensureMysqlDatabaseAndGrant(mysqlRootEnvConn(), mysqlDb, conn.user);
    const rows = generateAll(spec);
    console.log(`  mysql → ${mysqlDb}`);
    await applyMysql(conn, mysqlDb, spec, rows, (e, n, ms) => {
      if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
      counts.mysql = (counts.mysql ?? 0) + n;
    });
  }

  if (shouldRunTarget(target, "sqlite")) {
    const path = sqliteEnvPath();
    const file = spec.profileSpec.database.sqlite;
    if (!file) {
      if (target !== "all")
        throw new Error("profile has no sqlite database configured");
    } else {
      await dropSqliteDatabase(path, file);
      const rows = generateAll(spec);
      console.log(`  sqlite → ${file}`);
      await applySqlite(path, file, spec, rows, (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
        counts.sqlite = (counts.sqlite ?? 0) + n;
      });
    }
  }

  if (shouldRunTarget(target, "duckdb")) {
    const path = duckdbEnvPath();
    const file = spec.profileSpec.database.duckdb;
    if (!file) {
      if (target !== "all")
        throw new Error("profile has no duckdb database configured");
    } else {
      await dropDuckdbDatabase(path, file);
      const rows = generateAll(spec);
      console.log(`  duckdb → ${file}`);
      await applyDuckdb(path, file, spec, rows, (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
        counts.duckdb = (counts.duckdb ?? 0) + n;
      });
    }
  }

  if (shouldRunTarget(target, "mariadb")) {
    const conn = mariadbEnvConn();
    const db = spec.profileSpec.database.mariadb;
    if (!db) {
      throw new Error("profile has no mariadb database configured");
    } else {
      await dropMariadbDatabase(mariadbRootEnvConn(), db);
      await ensureMariadbDatabaseAndGrant(mariadbRootEnvConn(), db, conn.user);
      const rows = generateAll(spec);
      console.log(`  mariadb → ${db}`);
      await applyMariadb(conn, db, spec, rows, (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
        counts.mariadb = (counts.mariadb ?? 0) + n;
      });
    }
  }

  if (shouldRunTarget(target, "mssql")) {
    const conn = mssqlEnvConn();
    const db = spec.profileSpec.database.mssql;
    if (!db) {
      throw new Error("profile has no mssql database configured");
    } else {
      await dropMssqlDatabase(conn, db);
      await ensureMssqlDatabase(conn, db);
      const rows = generateAll(spec);
      console.log(`  mssql → ${db}`);
      await applyMssql(conn, db, spec, rows, (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
        counts.mssql = (counts.mssql ?? 0) + n;
      });
    }
  }

  if (shouldRunTarget(target, "oracle")) {
    const conn = oracleEnvConn();
    const db = spec.profileSpec.database.oracle;
    if (!db) {
      throw new Error("profile has no oracle database configured");
    } else {
      await dropOracleTables(conn, db, spec);
      const rows = generateAll(spec);
      console.log(`  oracle → ${db}`);
      await applyOracle(conn, db, spec, rows, (e, n, ms) => {
        if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "rows")}`);
        counts.oracle = (counts.oracle ?? 0) + n;
      });
    }
  }

  if (shouldRunTarget(target, "redis")) {
    const dbNum = spec.profileSpec.database.redis ?? 0;
    const conn = redisEnvConn(dbNum);
    await dropRedisDatabase(conn);
    const rows = generateAll(spec);
    console.log(`  redis → db${dbNum}`);
    await applyRedis(conn, spec, rows, (e, n, ms) => {
      if (!isQuiet) console.log(`    ${formatEntity(e, n, ms, "keys")}`);
      counts.redis = (counts.redis ?? 0) + n;
    });
  }

  const summary = Object.entries(counts)
    .map(([k, v]) => `${v.toLocaleString()} ${k}`)
    .join(" + ");
  console.log(
    `done — ${summary || "nothing to reset"} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

async function cmdConnections(action: string, profile: string): Promise<void> {
  if (action === "upsert") {
    const spec = loadSpec(profile);
    const r = await upsertConnections(spec, { ensureMysql: true });
    console.log(
      `db:connections upsert ${profile} — added=${r.added}, updated=${r.updated}`,
    );
  } else if (action === "clear") {
    const r = clearConnections();
    console.log(
      `db:connections clear — removed=${r.removed} fixture-* connection(s)`,
    );
  } else if (action === "") {
    console.error(
      [
        "Usage:",
        "  pnpm db:connections upsert <profile>",
        "  pnpm db:connections clear",
        "",
        "Available profiles (fixtures/profiles/*.yaml):",
        "  development  — 5K-20K rows, daily dev workflow",
        "  e2e          — 200-1500 rows, e2e fixture (dormant)",
        "",
        "Examples:",
        "  pnpm db:connections upsert development",
        "  pnpm db:connections upsert e2e",
        "  pnpm db:connections clear",
      ].join("\n"),
    );
    process.exit(2);
  } else {
    throw new Error(
      `unknown connections action '${action}' (expected: upsert | clear)`,
    );
  }
}

function cmdGenerate(profile: string, target: Target): void {
  const spec = loadSpec(profile);
  const rows = generateAll(spec);
  console.log(`# db:generate ${profile} (target=${target})`);
  for (const entityName of entityOrder(spec.base)) {
    const entity = spec.base.entities[entityName];
    if (!entity) continue;
    const data = rows[entityName] ?? [];
    if (
      (target === "all" || target === "pg") &&
      entity.pg &&
      entity.targets.includes("pg")
    ) {
      console.log(
        `# pg ${entity.pg.schema}.${entity.pg.table} — ${data.length} rows`,
      );
      console.log(JSON.stringify(data.slice(0, 3), null, 2));
    }
    if (
      (target === "all" || target === "mongo") &&
      entity.mongo &&
      entity.targets.includes("mongo")
    ) {
      console.log(`# mongo ${entity.mongo.collection} — ${data.length} docs`);
      console.log(JSON.stringify(data.slice(0, 3), null, 2));
    }
  }
}

function formatEntity(
  name: string,
  n: number,
  ms: number,
  unit: string,
): string {
  return `${name.padEnd(20)} ${n.toLocaleString().padStart(8)} ${unit}  ${ms}ms`;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm db:seed <profile> [--target <db>] [--quiet]",
    "  pnpm db:reset <profile> [--target <db>] [--quiet]",
    "  pnpm db:connections upsert <profile>",
    "  pnpm db:connections clear",
    "  pnpm db:generate <profile> [--target <db>]",
    "",
    "Targets: all/default (pg + mongo + mysql + sqlite + duckdb + redis) | pg | mongo | mysql | sqlite | duckdb | mariadb | mssql | oracle | redis",
  ].join("\n");
}

async function main(): Promise<void> {
  const { subcommand, positional, options } = parse(process.argv.slice(2));
  const target = targetMode(options);
  const isQuiet = quiet(options);

  switch (subcommand) {
    case "seed": {
      const profile = positional[0];
      if (!profile)
        throw new Error(`'seed' requires a profile name.\n${usage()}`);
      await cmdSeed(profile, target, isQuiet);
      break;
    }
    case "reset": {
      const profile = positional[0];
      if (!profile)
        throw new Error(`'reset' requires a profile name.\n${usage()}`);
      await cmdReset(profile, target, isQuiet);
      break;
    }
    case "connections": {
      const action = positional[0] ?? "";
      const profile = positional[1] ?? "";
      if (action === "upsert" && !profile)
        throw new Error(`'connections upsert' requires a profile name.`);
      await cmdConnections(action, profile);
      break;
    }
    case "generate": {
      const profile = positional[0];
      if (!profile)
        throw new Error(`'generate' requires a profile name.\n${usage()}`);
      cmdGenerate(profile, target);
      break;
    }
    default:
      console.error(usage());
      process.exit(subcommand === "" ? 0 : 2);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`error: ${msg}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  console.error(
    "Use 'pnpm db:reset <profile>' to recover from partial-state failures.",
  );
  process.exit(1);
});
