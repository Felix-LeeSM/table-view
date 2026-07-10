// Issue #1352 — FE<->BE classifier parity via a SHARED fixture. Before this,
// backend/frontend severity parity was held by a hand-copied "Parity mirror"
// block in `src-tauri/sql-parser-core/src/safety.rs` (manual copy-paste, the
// only safety net — drift like the #1350 multi-CTE hole passed green). This
// test and the Rust `classifier_parity_fixture` test now consume the SAME
// `tests/fixtures/classifier-parity.json`, so a classifier change on one side
// that drifts the other trips a test on that side.
//
// Env note: vitest runs in jsdom WITHOUT the WASM AST, so `analyzeStatement`
// here takes the regex fallback. The fixture is curated to the cases whose
// regex-fallback verdict equals the backend native `parse` verdict; cases that
// depend on the WASM AST (EXPLAIN inner-inheritance, `ALTER … DROP INDEX`)
// stay in each side's own unit tests, not this shared fixture.
import { describe, expect, it } from "vitest";
import fixtureRaw from "../../../tests/fixtures/classifier-parity.json?raw";
import {
  analyzeStatement,
  type Severity,
  type StatementAnalysisOptions,
} from "./sqlSafety";

interface ParityCase {
  name: string;
  sql: string;
  expectedSeverity: Severity;
  // Issue #1450 — optional per-case dialect (only MySQL changes a verdict).
  dialect?: StatementAnalysisOptions["dialect"];
}
interface ParityFixture {
  cases: ParityCase[];
}

const fixture = JSON.parse(fixtureRaw) as ParityFixture;

describe("[#1352] FE<->BE classifier parity — shared fixture", () => {
  it("fixture is non-empty (guards a silently-emptied file)", () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const c of fixture.cases) {
    it(`${c.name}: ${c.sql}`, () => {
      const options = c.dialect ? { dialect: c.dialect } : undefined;
      expect(analyzeStatement(c.sql, options).severity).toBe(
        c.expectedSeverity,
      );
    });
  }
});
