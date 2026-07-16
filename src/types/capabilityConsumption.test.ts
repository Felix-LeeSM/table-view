import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyDataSourceCapabilities } from "./dataSource";

// Issue #1464 (Refs #1043) — lock "declared but UI-unconsumed capability flag"
// at zero. Every flag on `DataSourceCapabilities` must be read by at least one
// production consumer (component / hook / store / capability helper); a flag
// that only appears in its own declaration, the reflective self-describe files,
// and tests is dead weight and must be deleted rather than left as a speculative
// claim the UI silently ignores.
//
// The scan is intentionally textual (not an AST/lint rule): capability
// consumption is a whole-program question ("is this flag read ANYWHERE"), which
// a per-file ESLint rule cannot answer without hacky shared state, whereas a
// single scan test reads every source once and enumerates the flag set from
// `createEmptyDataSourceCapabilities()` at runtime, so it auto-adapts when a
// flag is added or removed.

const PROJECT_ROOT = process.cwd();
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
// Scan `src/` AND `scripts/`: a capability flag can be consumed by a build/CI
// script too (#1464 review found `scripts/e2e-pre-smoke-release-gate.ts` reads
// the profile flags), so a `src`-only scan would miss those consumers and let a
// still-referenced flag look dead.
const SCAN_ROOTS = [SRC_ROOT, resolve(PROJECT_ROOT, "scripts")];

// Reflective/self-describe files read EVERY flag via `Object.entries` /
// group spreads (adapterConformance's ADAPTER_CONFORMANCE_MATRIX,
// dataSourceVersionCapabilities' clone/freeze). They are not production UI
// consumers, so counting them would make every flag falsely "consumed" and the
// guard meaningless. `dataSource.ts` is NOT excluded: its declaration literals
// use the `flag:` colon form (never matched below), while its capability
// helpers (`supportsRowEditing`, `dialectRequiresPrimaryKeyForEdit`, ...) hold
// the real accessor reads for flags the UI consumes only indirectly.
const EXCLUDED_FILES = new Set([
  resolve(SRC_ROOT, "types/adapterConformance.ts"),
  resolve(SRC_ROOT, "types/dataSourceVersionCapabilities.ts"),
  // #1464 — the CI release gate asserts the *declared* capability shape of the
  // mssql/oracle/search release slices (a self-describe smoke-lock on the
  // profile constants), it does not branch runtime behavior on a flag. Counting
  // it as a consumer would let a dead flag masquerade as live purely by being
  // smoke-locked — same reflexive-read exclusion rationale as the two files
  // above.
  resolve(PROJECT_ROOT, "scripts/e2e-pre-smoke-release-gate.ts"),
]);

// Groups whose flags are consumed by extracting the whole group object and
// reading each flag off it (e.g. `useOperationsConnection` does
// `const caps = profile.capabilities.operations; caps.activity`). Such reads
// produce a leaf accessor (`.activity`) rather than a group-qualified one
// (`.operations.activity`), so they need the destructure recognition below.
// ponytail: hardcoded because `operations` is the only group with this shape
// today; a new destructure-consumed group would fail this guard until added
// here — a safe, self-announcing failure.
const GROUP_DESTRUCTURE_CONSUMERS = new Set(["operations"]);

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collectSourceFiles(path, acc);
    } else if (
      /\.(ts|tsx)$/.test(path) &&
      !/\.(test|spec)\.[tj]sx?$/.test(path)
    ) {
      acc.push(path);
    }
  }
  return acc;
}

// Drop comments (so JSDoc mentions like `catalog.browse` do not count as
// consumers) and collapse whitespace around member-access dots (so a fluent
// chain broken across lines — `capabilities.edit\n  .requiresPrimaryKeyForEdit`
// — is still recognized as a qualified read).
function normalize(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/\s*\.\s*/g, ".");
}

function listDeclaredFlags(): { group: string; flag: string }[] {
  const empty = createEmptyDataSourceCapabilities() as unknown as Record<
    string,
    Record<string, boolean>
  >;
  return Object.entries(empty).flatMap(([group, flags]) =>
    Object.keys(flags).map((flag) => ({ group, flag })),
  );
}

function isConsumed(
  group: string,
  flag: string,
  normalizedSources: readonly string[],
): boolean {
  // 1. Group-qualified accessor read: `capabilities.query.explain`.
  const qualified = new RegExp(`\\.${group}\\.${flag}\\b`);
  // 2. Flag name passed as a literal to a capability helper:
  //    `hasConnectionCapability(dbType, "readOnly")`,
  //    `supportsDdl(dbType, "createTable")`. Scoped to `supports*`/`has*`
  //    calls so an unrelated string literal (e.g. the `"schema"` graph-node
  //    kind) never counts as consumption.
  const helperLiteral = new RegExp(
    `(?:supports|has)\\w*\\([^)]*["']${flag}["']`,
  );
  const groupRead = new RegExp(`\\.${group}\\b`);
  const leafRead = new RegExp(`\\.${flag}\\b`);
  const destructured = GROUP_DESTRUCTURE_CONSUMERS.has(group);

  return normalizedSources.some(
    (source) =>
      qualified.test(source) ||
      helperLiteral.test(source) ||
      (destructured && groupRead.test(source) && leafRead.test(source)),
  );
}

describe("DataSourceCapabilities flag consumption (#1464)", () => {
  it("declares no capability flag that lacks a production consumer", () => {
    const normalizedSources = SCAN_ROOTS.flatMap((root) =>
      collectSourceFiles(root),
    )
      .filter((path) => !EXCLUDED_FILES.has(path))
      .map((path) => normalize(readFileSync(path, "utf8")));

    const unconsumed = listDeclaredFlags()
      .filter(({ group, flag }) => !isConsumed(group, flag, normalizedSources))
      .map(({ group, flag }) => `${group}.${flag}`);

    expect(
      unconsumed,
      `Declared-but-unconsumed capability flags (delete the flag or wire a ` +
        `consumer): ${unconsumed.join(", ")}`,
    ).toEqual([]);
  });
});
