// Concrete violating strings live HERE, in string literals, on purpose: the
// gate must not flag them, which is the same property that keeps a legitimate
// stack-trace assertion writable. The rule module itself documents its shapes
// with `N` placeholders for the same reason.
import { describe, expect, it } from "vitest";
import {
  extractCommentBlocks,
  findLineNumberRefViolations,
  findUnresolvedRefViolations,
  isCommentRefScanPath,
} from "../static-policy/comment-refs";

const STEMS = new Set([
  "SchemaTree",
  "persistence",
  "mariadb",
  "documentStore",
]);

function lineNumberHits(path: string, source: string): string[] {
  return findLineNumberRefViolations(new Map([[path, source]]), STEMS).map(
    (violation) => violation.snippet,
  );
}

describe("extractCommentBlocks", () => {
  it("joins consecutive standalone line comments so a wrapped phrase is one string", () => {
    const blocks = extractCommentBlocks(
      "a.ts",
      [
        "// Strategy doc line",
        "// 1389 says receivers do not refetch.",
        "const x = 1;",
      ].join("\n"),
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(
      "Strategy doc line 1389 says receivers do not refetch.",
    );
    expect(blocks[0].startLine).toBe(1);
    expect(blocks[0].endLine).toBe(2);
  });

  it("never joins trailing comments, which would invent an adjacency", () => {
    const blocks = extractCommentBlocks(
      "a.ts",
      ["foo(); // see bar.ts", "baz(); // 213 rows"].join("\n"),
    );
    expect(blocks.map((block) => block.text)).toEqual([
      "see bar.ts",
      "213 rows",
    ]);
  });

  it("skips string literals, including Rust raw strings", () => {
    const source = [
      'let a = "// not a comment sqlSafety.ts:12";',
      'let b = r#"// also not one query.rs:34"#;',
      "// real one",
    ].join("\n");
    expect(extractCommentBlocks("a.rs", source).map((b) => b.text)).toEqual([
      "real one",
    ]);
  });

  it("treats a Rust lifetime as code, not as an unterminated char literal", () => {
    const source = ["fn f<'a>(x: &'a str) {}", "// after the lifetime"].join(
      "\n",
    );
    expect(extractCommentBlocks("a.rs", source).map((b) => b.text)).toEqual([
      "after the lifetime",
    ]);
  });

  it("ignores fenced code in markdown but reads prose paragraphs", () => {
    const source = ["```", "sample.ts:12", "```", "", "prose foo.ts:34"].join(
      "\n",
    );
    expect(extractCommentBlocks("a.md", source).map((b) => b.text)).toEqual([
      "prose foo.ts:34",
    ]);
  });

  it("excludes frozen snapshot trees and non-scanned extensions", () => {
    expect(isCommentRefScanPath("src/a.ts")).toBe(true);
    expect(isCommentRefScanPath("memory/x/memory.md")).toBe(true);
    expect(isCommentRefScanPath("docs/archives/x.md")).toBe(false);
    expect(isCommentRefScanPath("docs/explorations/x.md")).toBe(false);
    expect(isCommentRefScanPath("docs/sprints/x.md")).toBe(false);
    expect(isCommentRefScanPath("lefthook.yml")).toBe(true);
    expect(isCommentRefScanPath("a.json")).toBe(false);
  });
});

describe("findLineNumberRefViolations — the shapes the #1853 sweep removed", () => {
  it.each([
    ["path with a line number", "// see query.rs:83 for the branch"],
    ["path with a tilde range", "// see sqlSafetyClassifier.ts ~538-542"],
    [
      "path with a parenthesised number",
      "// db/postgres.rs (390 line) wrapper",
    ],
    ["prose singular", "// Strategy doc line 1388 pins this"],
    ["prose range", "// strategy doc lines 692-727 list the wire types"],
    ["korean 라인", "// Strategy 라인 1189 로 reject"],
    ["korean 줄", "// strategy 문서 줄 534 의 9 table"],
    ["number first", "// (state-management-strategy, Q22 + 873-905 line)"],
    ["LNNN", "// mirrors column.rs L180"],
    ["bare design-doc number", "// drop without migration (strategy doc 745)"],
    ["module stem", "// replaces the SchemaTree:603 direct setState"],
    ["module path stem", "// stores/workspaceStore/persistence:48 writes it"],
    ["colon range on a package", "// addNamespaceObject (lang-sql:507-523)"],
  ])("flags %s", (_name, comment) => {
    expect(lineNumberHits("src/a.ts", comment)).toHaveLength(1);
  });

  it("flags a phrase the author wrapped across two comment lines", () => {
    expect(
      lineNumberHits("src/a.ts", "// Strategy doc line\n// 1389 — receivers"),
    ).toEqual(["line 1389"]);
  });

  it("flags a line-number reference inside a SQL comment", () => {
    expect(
      lineNumberHits("m/0001.sql", "-- connections — strategy line 1156"),
    ).toHaveLength(1);
  });

  it.each([
    [
      "a stack-trace frame in a string literal",
      'expect(e.stack).toContain("at parseSql (src/lib/sql/sqlTokenize.ts:213:9)");',
    ],
    [
      "a stack-trace frame quoted in a comment",
      "// stack reads `at parseSql (sqlTokenize.ts:213:9)`",
    ],
    ["a coverage flag", "// runs with --fail-under-lines 80 today"],
    [
      "a coverage threshold triple",
      "# thresholds (lines 80 / functions 75 / regions 80)",
    ],
    ["a measured coverage percentage", "// lines 88.70 measured on main"],
    ["a file size", "// Split from ConnectionDialog.test.tsx (1300+ lines)"],
    ["a line count", "// god-file gate trips over 700 lines"],
    ["a docker image tag", "// pinned to mariadb:11 in the compose file"],
    ["a URL port", "// dev server on http://localhost:8080"],
    [
      "a rust error string path",
      "// error reads sqlx_postgres::connection::describe:492",
    ],
    ["a dated snapshot name", "// per state-management-strategy 2026-05-15"],
    ["an issue number", "// strategy follow-up in #1839"],
    ["a schema file id", "// strategy doc F.5 (sprint-371 의 schema 0001)"],
    ["an AC matrix label", "// AC-245-L1 through AC-245-L8"],
  ])("does not flag %s", (_name, source) => {
    expect(lineNumberHits("src/a.ts", source)).toEqual([]);
  });

  it("does not flag CSV fixture data that happens to read like a citation", () => {
    expect(lineNumberHits("src/a.ts", 'const csv = "line1\\nline2";')).toEqual(
      [],
    );
  });
});

describe("findUnresolvedRefViolations", () => {
  const tracked = ["src/a.ts", "src/stores/slices/tabSlice.ts"];
  const target = ["export function removeTab() {}"].join("\n");

  function resolveIn(comment: string) {
    return findUnresolvedRefViolations(
      new Map([
        ["src/a.ts", comment],
        ["src/stores/slices/tabSlice.ts", target],
      ]),
      tracked,
      process.cwd(),
    );
  }

  it("passes a citation whose symbol exists in the cited file", () => {
    const result = resolveIn(
      "// newest-first per `slices/tabSlice.ts` `removeTab`",
    );
    expect(result.unresolved).toEqual([]);
    expect(result.checked).toBeGreaterThan(0);
  });

  it("fails a citation whose symbol does not exist in the cited file", () => {
    const result = resolveIn(
      "// newest-first per `slices/tabSlice.ts` `closeTab`",
    );
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toContain("`closeTab` is not in");
  });

  it("leaves a non-adjacent name unchecked instead of guessing", () => {
    const result = resolveIn(
      "// `slices/tabSlice.ts` is the writer; the local `closeTab` helper is not",
    );
    expect(result.unresolved).toEqual([]);
  });

  it("passes a design-doc section title that lives under the cited tag", () => {
    const result = resolveIn('// boot 자체는 진행 (F.2 "Partial fallback").');
    expect(result.unresolved).toEqual([]);
    expect(result.checked).toBeGreaterThan(0);
  });

  it("fails a section title that exists but under a different tag", () => {
    const result = resolveIn('// boot 자체는 진행 (Q13 "Partial fallback").');
    expect(result.unresolved).toHaveLength(1);
    expect(result.unresolved[0].reason).toContain("not under Q13");
  });

  it("reports a bare design-doc tag as unverifiable rather than passing it", () => {
    const result = resolveIn(
      "// Sprint 363 (Phase 3, Q13 lock) — launcher close",
    );
    expect(result.unresolved).toEqual([]);
    expect(result.unverifiable.map((v) => v.reason)).toContain(
      "design-doc tag carries no section title",
    );
  });
});
