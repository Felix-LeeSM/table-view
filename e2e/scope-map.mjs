#!/usr/bin/env node
// Changed paths -> the smoke specs that have to run for them.
//
// Node-only and dependency-free on purpose: `.github/workflows/e2e-smoke.yml`
// runs this before `pnpm install`, so `Runtime Happy Path` can decide its own
// scope without paying for a toolchain first.
//
//   git diff --name-only "origin/main...HEAD" | node e2e/scope-map.mjs
//   node e2e/scope-map.mjs src-tauri/table-view-core/src/db/postgres.rs  # paths as args
//   node e2e/scope-map.mjs --services <paths>             # services those specs need
//   node e2e/scope-map.mjs --all                          # every mapped spec
//   node e2e/scope-map.mjs --self-test                    # mapping fixtures
//
// Output is one `e2e/smoke/<key>.spec.ts` per line, sorted, deduped. An empty
// selection prints nothing and exits 0 — the workflow, not this script, decides
// what that means.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SMOKE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "smoke",
);

// spec key -> external services the spec needs alive.
//
// NOT the same table as `SEED_TARGETS_BY_SPEC_KEY` in e2e/fixtures/seed-smoke.ts:
// that one lists what gets *seeded*, this one what has to be *running*.
// `redis-empty-state-window` seeds nothing and still needs a live redis, and
// sqlite/duckdb are embedded so they need nothing at all. The rest matches the
// `needs_*` matrix flags the pre-6cced3ab workflow ran green.
//
// This object is also the spec universe: its keys are the full suite, and
// --self-test fails when e2e/smoke/ and these keys drift apart.
const SPEC_SERVICES = {
  postgres: ["postgres"],
  "postgres-cancellation": ["postgres"],
  "postgres-explain": ["postgres"],
  "postgres-extension-completion": ["postgres"],
  "postgres-safe-mode": ["postgres"],
  "postgres-safe-mode-matrix": ["postgres"],
  "postgres-structure-ddl": ["postgres"],
  "erd-dense": ["postgres"],
  "history-source-5": ["postgres", "mongodb"],
  mysql: ["mysql"],
  mariadb: ["mariadb"],
  mongodb: ["mongodb"],
  "phase-28-slice-A": ["mongodb"],
  mssql: ["mssql"],
  "mssql-schema-filter": ["mssql"],
  oracle: ["oracle"],
  redis: ["redis"],
  "redis-key-detail-panel": ["redis"],
  "redis-empty-state-window": ["redis"],
  valkey: ["valkey"],
  elasticsearch: ["elasticsearch"],
  opensearch: ["opensearch"],
  sqlite: [],
  duckdb: [],
  "duckdb-schema-filter": [],
  "duckdb-file-analytics": [],
};

// e2e/smoke/postgres-multi-table-edit.spec.ts is deliberately absent: it has no
// entry in `SEED_TARGETS_BY_SPEC_KEY`, so seed-smoke.ts falls back to seeding
// EVERY target for it and the run dies against services no scoped run starts.
// The pre-6cced3ab matrix never ran it either. Fix is one line in
// seed-smoke.ts (`"postgres-multi-table-edit": ["postgres"]`); until it lands,
// listing the spec here would only produce a red scoped run.
const UNMAPPED_SPECS = ["postgres-multi-table-edit"];

const ALL = Object.keys(SPEC_SERVICES);
const NONE = [];

const POSTGRES = [
  "postgres",
  "postgres-cancellation",
  "postgres-explain",
  "postgres-extension-completion",
  "postgres-safe-mode",
  "postgres-safe-mode-matrix",
  "postgres-structure-ddl",
  "erd-dense",
];
const MYSQL_FAMILY = ["mysql", "mariadb"];
const MONGODB = ["mongodb", "phase-28-slice-A"];
const REDIS_FAMILY = [
  "redis",
  "redis-key-detail-panel",
  "redis-empty-state-window",
  "valkey",
];
const SEARCH_FAMILY = ["elasticsearch", "opensearch"];
const MSSQL = ["mssql", "mssql-schema-filter"];
const ORACLE = ["oracle"];
const DUCKDB = ["duckdb", "duckdb-schema-filter", "duckdb-file-analytics"];
const SQLITE = ["sqlite"];

// One representative per paradigm: relational, MySQL dialect, document.
const PARSER_REPS = ["postgres", "mysql", "mongodb"];
// Grid/document journeys, by the component each spec actually drives.
const GRID = ["postgres", "postgres-safe-mode", "history-source-5"];
const DOCUMENT = MONGODB;
// Tooling changes get one representative smoke, not the suite: a PR that only
// edits the selector or the workflow that runs it must not be held hostage by
// all 26 specs, and one real spec still proves the runner works end to end.
const TOOLING = ["postgres"];

// First match wins, so order is load-bearing: the two tooling files sit above
// the blanket .github/docs rules, and the wasm bindings above shared-core.
const RULES = [
  [/^e2e\/scope-map\.mjs$/, TOOLING],
  [/^\.github\/workflows\/e2e-smoke\.yml$/, TOOLING],

  [/\.md$/, NONE],
  [/^(docs|memory|\.agents|\.github)\//, NONE],
  // Documentation too: no code reads it, and docker compose loads `.env`.
  [/^\.env\.example$/, NONE],

  [/^src-tauri\/(sql|mongosh)-parser-core\//, PARSER_REPS],
  [/^src\/lib\/(sql|mongo)\/wasm\//, PARSER_REPS],

  // #1769 moved the adapter tree from `src-tauri/src/db/` into the
  // `table-view-core` path crate. The rules are fail-closed (an unmatched path
  // runs the whole suite), so a stale prefix here would not break the gate —
  // it would silently stop narrowing and run everything on every adapter edit.
  [/^src-tauri\/table-view-core\/src\/db\/postgres(\/|\.rs$)/, POSTGRES],
  [/^src-tauri\/table-view-core\/src\/db\/mysql(\/|\.rs$)/, MYSQL_FAMILY],
  [/^src-tauri\/table-view-core\/src\/db\/mongodb(\/|\.rs$)/, MONGODB],
  [/^src-tauri\/table-view-core\/src\/db\/redis(\/|\.rs$)/, REDIS_FAMILY],
  [/^src-tauri\/table-view-core\/src\/db\/search/, SEARCH_FAMILY],
  [/^src-tauri\/table-view-core\/src\/db\/mssql(\/|\.rs$)/, MSSQL],
  [/^src-tauri\/table-view-core\/src\/db\/oracle(\/|\.rs$)/, ORACLE],
  [/^src-tauri\/table-view-core\/src\/db\/duckdb(\/|\.rs$)/, DUCKDB],
  [
    /^src-tauri\/table-view-core\/src\/db\/(sqlite\.rs$|adapters\/sqlite\/)/,
    SQLITE,
  ],

  [/^src\/components\/datagrid\//, GRID],
  [/^src\/components\/document\//, DOCUMENT],
];

// Anything the rules do not name runs the full suite (fail-closed): shared
// frontend core, `src-tauri/src/**` outside an adapter, package.json,
// pnpm-lock.yaml, wdio*, vite.config.ts, e2e/smoke/**, e2e/fixtures/**.
export function selectSpecKeys(changedPaths) {
  const selected = new Set();
  for (const raw of changedPaths) {
    const file = raw.trim();
    if (!file) continue;
    const rule = RULES.find(([pattern]) => pattern.test(file));
    for (const key of rule ? rule[1] : ALL) selected.add(key);
  }
  return [...selected].sort();
}

export const specPath = (key) => `e2e/smoke/${key}.spec.ts`;

export function servicesFor(specKeys) {
  const services = new Set();
  for (const key of specKeys)
    for (const s of SPEC_SERVICES[key]) services.add(s);
  return [...services].sort();
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const CASES = [
  // Nothing runtime-relevant.
  [["docs/PLAN.md"], NONE],
  [["memory/workflow/delivery/memory.md", "AGENTS.md"], NONE],
  [[".agents/prompts/orchestrator.md", ".github/workflows/ci.yml"], NONE],
  [[".env.example", "README.md"], NONE],
  // Tooling: this selector and the workflow that runs it.
  [["e2e/scope-map.mjs"], TOOLING],
  [[".github/workflows/e2e-smoke.yml"], TOOLING],
  [["e2e/scope-map.mjs", "docs/PLAN.md"], TOOLING],
  // Adapters.
  [["src-tauri/table-view-core/src/db/postgres/schema.rs"], POSTGRES],
  [["src-tauri/table-view-core/src/db/mysql.rs"], MYSQL_FAMILY],
  [["src-tauri/table-view-core/src/db/mongodb/query.rs"], MONGODB],
  [["src-tauri/table-view-core/src/db/redis.rs"], REDIS_FAMILY],
  [["src-tauri/table-view-core/src/db/search_executor.rs"], SEARCH_FAMILY],
  [["src-tauri/table-view-core/src/db/mssql/mod.rs"], MSSQL],
  [["src-tauri/table-view-core/src/db/oracle.rs"], ORACLE],
  [["src-tauri/table-view-core/src/db/duckdb.rs"], DUCKDB],
  [["src-tauri/table-view-core/src/db/adapters/sqlite/mod.rs"], SQLITE],
  // Guard against the pre-#1769 prefix silently coming back: those paths no
  // longer exist, so they must fall through to the full suite, not to an
  // adapter subset.
  [["src-tauri/src/db/postgres/schema.rs"], ALL],
  // Parser core + generated wasm bindings.
  [["src-tauri/sql-parser-core/src/lib.rs"], PARSER_REPS],
  [["src/lib/mongo/wasm/mongosh_parser_core.js"], PARSER_REPS],
  // Components.
  [["src/components/datagrid/DataGridTable.tsx"], GRID],
  [["src/components/document/DocumentDataGrid.tsx"], DOCUMENT],
  // Shared core and anything unnamed: full suite.
  [["src/lib/tauri/commands.ts"], ALL],
  [["src/stores/connectionStore.ts"], ALL],
  [["src-tauri/src/commands/query.rs"], ALL],
  [["pnpm-lock.yaml"], ALL],
  [["wdio.smoke.conf.ts"], ALL],
  [["e2e/smoke/postgres.spec.ts"], ALL],
  [["src/lib/sql/sqlSafety.ts"], ALL],
  // Union across files, and services derived from the selection.
  [["docs/PLAN.md", "src-tauri/table-view-core/src/db/oracle.rs"], ORACLE],
  [
    [
      "src-tauri/table-view-core/src/db/postgres.rs",
      "src-tauri/table-view-core/src/db/mysql/ddl.rs",
    ],
    [...POSTGRES, ...MYSQL_FAMILY],
  ],
];

function selfTest() {
  const failures = [];
  const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

  for (const [paths, expected] of CASES) {
    const got = selectSpecKeys(paths);
    const want = [...new Set(expected)].sort();
    if (!eq(got, want)) {
      failures.push(
        `paths ${JSON.stringify(paths)}\n    expected: ${want.join(",") || "(none)"}\n    got:      ${got.join(",") || "(none)"}`,
      );
    }
  }

  const servicePairs = [
    [["src-tauri/table-view-core/src/db/redis.rs"], ["redis", "valkey"]],
    [["src-tauri/table-view-core/src/db/adapters/sqlite/mod.rs"], []],
    [["src/components/datagrid/DataGridTable.tsx"], ["mongodb", "postgres"]],
  ];
  for (const [paths, want] of servicePairs) {
    const got = servicesFor(selectSpecKeys(paths));
    if (!eq(got, want)) {
      failures.push(
        `services for ${JSON.stringify(paths)}\n    expected: ${want.join(",") || "(none)"}\n    got:      ${got.join(",") || "(none)"}`,
      );
    }
  }

  // Drift guard: a new spec file that nobody mapped would silently never run.
  const onDisk = readdirSync(SMOKE_DIR)
    .filter((f) => f.endsWith(".spec.ts"))
    .map((f) => f.replace(/\.spec\.ts$/, ""))
    .sort();
  const known = [...ALL, ...UNMAPPED_SPECS].sort();
  const missing = onDisk.filter((k) => !known.includes(k));
  const stale = known.filter((k) => !onDisk.includes(k));
  if (missing.length)
    failures.push(
      `e2e/smoke specs missing from SPEC_SERVICES: ${missing.join(", ")}`,
    );
  if (stale.length)
    failures.push(`SPEC_SERVICES keys with no spec file: ${stale.join(", ")}`);

  if (failures.length) {
    console.error(`scope-map self-test FAILED (${failures.length}):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `scope-map self-test ok — ${CASES.length + servicePairs.length} cases, ${ALL.length} mapped specs`,
  );
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) {
  selfTest();
} else {
  const wantServices = argv.includes("--services");
  const all = argv.includes("--all");
  const paths = argv.filter((a) => !a.startsWith("--"));
  const keys = all
    ? [...ALL].sort()
    : selectSpecKeys(paths.length ? paths : readStdin().split("\n"));
  const out = wantServices ? servicesFor(keys) : keys.map(specPath);
  if (out.length) process.stdout.write(`${out.join("\n")}\n`);
}
