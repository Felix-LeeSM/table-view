import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COMPLETION_FEATURE_PUBLIC_API_PATH,
  COMPLETION_FEATURE_REFERENCE_DOC_PATHS,
  findCompletionFeatureBoundaryViolations,
} from "../check-eslint-static-policy";

// Separate from check-eslint-static-policy.test.ts, which sits just under the
// 700-line max-lines cap; these cases would push it into new debt.
describe("completion feature reference doc paths", () => {
  it("scans a horizon child page, not just the roadmap index", () => {
    const failures = findCompletionFeatureBoundaryViolations(
      new Map([
        [
          COMPLETION_FEATURE_PUBLIC_API_PATH,
          "export { buildSqlCompletionContext } from './sql/sqlCompletionContext';\n",
        ],
        [
          "docs/roadmap/h2.md",
          "Evidence: `src/lib/sql/sqlCompletionContext.test.ts`.",
        ],
      ]),
    );

    expect(failures).toContain(
      "docs/roadmap/h2.md: stale moved completion reference src/lib/sql/sqlCompletionContext.test.ts; use src/features/completion/sql/sqlCompletionContext.test.ts.",
    );
  });

  // The guard only reads paths on the list, so a horizon page that exists but is
  // unregistered is scanned as if it were empty — the silent coverage loss the
  // ROADMAP.md split introduced. Fails when a new horizon page lands unregistered.
  it("registers every roadmap child page for scanning", () => {
    const onDisk = readdirSync("docs/roadmap")
      .filter((name) => name.endsWith(".md"))
      .map((name) => `docs/roadmap/${name}`)
      .sort();

    expect(onDisk.length).toBeGreaterThan(0);
    for (const path of onDisk) {
      expect(COMPLETION_FEATURE_REFERENCE_DOC_PATHS).toContain(path);
    }
  });
});
