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
import { clearConnections, upsertConnections } from "./connections.js";

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

function targetMode(
  options: Record<string, string | boolean>,
): "all" | "pg" | "mongo" {
  const t = options.target;
  if (t === "pg" || t === "postgres" || t === "postgresql") return "pg";
  if (t === "mongo" || t === "mongodb") return "mongo";
  return "all";
}

function quiet(options: Record<string, string | boolean>): boolean {
  return options.quiet === true || options.quiet === "true";
}

async function cmdSeed(
  profile: string,
  target: "all" | "pg" | "mongo",
  isQuiet: boolean,
): Promise<void> {
  const spec = loadSpec(profile);
  console.log(`db:seed ${profile} (target=${target})`);

  let pgRows = 0;
  let mongoDocs = 0;
  const t0 = Date.now();
  const wantPg = target === "all" || target === "pg";
  const wantMongo = target === "all" || target === "mongo";

  if (wantPg) {
    const conn = pgEnvConn();
    await ensurePgDatabase(conn, spec.profileSpec.database.pg);
    if (await pgIsPopulated(conn, spec.profileSpec.database.pg, spec)) {
      console.log(
        `  postgres → ${spec.profileSpec.database.pg}: already seeded — use 'db:reset' to refill`,
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
          pgRows += n;
        },
      );
    }
  }

  if (wantMongo) {
    const conn = mongoEnvConn();
    if (await mongoIsPopulated(conn, spec.profileSpec.database.mongo, spec)) {
      console.log(
        `  mongodb → ${spec.profileSpec.database.mongo}: already seeded — use 'db:reset' to refill`,
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
          mongoDocs += n;
        },
      );
    }
  }
  console.log(
    `done — ${pgRows.toLocaleString()} rows + ${mongoDocs.toLocaleString()} docs in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

async function cmdReset(
  profile: string,
  target: "all" | "pg" | "mongo",
  isQuiet: boolean,
): Promise<void> {
  const spec = loadSpec(profile);
  console.log(`db:reset ${profile} (target=${target})`);

  let pgRows = 0;
  let mongoDocs = 0;
  const t0 = Date.now();

  if (target === "all" || target === "pg") {
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
        pgRows += n;
      },
    );
  }

  if (target === "all" || target === "mongo") {
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
        mongoDocs += n;
      },
    );
  }
  console.log(
    `done — ${pgRows.toLocaleString()} rows + ${mongoDocs.toLocaleString()} docs in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
}

function cmdConnections(action: string, profile: string): void {
  if (action === "upsert") {
    const spec = loadSpec(profile);
    const r = upsertConnections(spec);
    console.log(
      `db:connections upsert ${profile} — added=${r.added}, updated=${r.updated}`,
    );
  } else if (action === "clear") {
    const r = clearConnections();
    console.log(
      `db:connections clear — removed=${r.removed} fixture-* connection(s)`,
    );
  } else if (action === "") {
    // 인자 없이 호출 → 친절한 usage 안내 (2026-05-13 Sprint 280).
    // pnpm 은 `--` 없이 인자를 못 넘기는 경우가 잦아 `pnpm db:connections`
    // 만 친 사용자가 cryptic error 만 보던 회귀를 차단.
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

function cmdGenerate(profile: string, target: "all" | "pg" | "mongo"): void {
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
    "  pnpm db:seed <profile> [--target pg|mongo|all] [--quiet]",
    "  pnpm db:reset <profile> [--target pg|mongo|all] [--quiet]",
    "  pnpm db:connections upsert <profile>",
    "  pnpm db:connections clear",
    "  pnpm db:generate <profile> [--target pg|mongo|all]",
  ].join("\n");
}

async function main(): Promise<void> {
  const { subcommand, positional, options } = parse(process.argv.slice(2));
  const target = targetMode(options);
  const isQuiet = quiet(options);

  void target;

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
      cmdConnections(action, profile);
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
