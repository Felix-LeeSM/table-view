import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SUPPORTED_DATABASE_TYPES } from "../features/connection/model";
import { QUERY_LANGUAGE_REGISTRY } from "./queryLanguage";

// Takes directories rather than a fixed file list: a SOT split across an index
// plus child pages can hold a claim in any of them, so a fixed list silently
// loses coverage the next time a page splits. Files are still accepted for an
// index that sits outside its own child directory, like docs/ROADMAP.md.
// Prose is whitespace-normalized so the claim guards below cannot be weakened
// by re-flowing a wide table cell into ~80-column paragraphs.
function readDocs(...paths: readonly string[]): string {
  return paths
    .flatMap((path) =>
      path.endsWith(".md")
        ? [path]
        : readdirSync(path)
            .filter((name) => name.endsWith(".md"))
            .map((name) => `${path}/${name}`),
    )
    .map((path) => normalizeDocProse(readFileSync(path, "utf8")))
    .join("\n\n");
}

/**
 * Collapse whitespace *inside* each paragraph and keep the blank line as a hard
 * boundary. Doc prose is moving out of wide GFM table cells into re-flowed
 * ~80-column paragraphs, so a physical line break no longer marks any semantic
 * boundary — a guard bounded by the line would silently stop seeing a claim
 * split across a wrap. A blank line stays a bound so a claim can never be
 * assembled from the tail of one paragraph plus the head of the next.
 * Same contract as `tests/fixtures/unsupported_boundary_contracts.test.ts`.
 */
function normalizeDocProse(text: string): string {
  return text
    .split(/\n[^\S\n]*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " "))
    .join("\n\n");
}

// Bounds after normalization: `.` = sentence end, `\n` = paragraph (and file)
// boundary, `|` = table-cell boundary while a row is still a table — inert but
// harmless once that row is re-flowed into prose.
const ACTIVE_CLAIM_PATTERNS = [
  /\bMSSQL\b[^.\n|]*(?:catalog-aware[^.\n|]*completion is active|structured DDL is active|full T-SQL semantics are active)/i,
  /\bOracle\b[^.\n|]*(?:routine smoke is active|routine smoke support is active)/i,
  /\bOracle\b[^.\n|]*(?:structured DDL|raw DDL\/admin|full parser\/completion|PL\/SQL)[^.\n|]*(?:is active|is supported|runtime support is active|support is active)/i,
  /SQL Server smoke, seeded/i,
  /\bOracle\b[^.\n|]*autocomplete is active/i,
];

function matchesAnyActiveClaim(text: string): boolean {
  return ACTIVE_CLAIM_PATTERNS.some((pattern) => pattern.test(text));
}

describe("query language support documentation", () => {
  it("documents every query language ownership record", () => {
    const supportDocs = readFileSync(
      "docs/product/query-language-support.md",
      "utf8",
    );

    for (const metadata of Object.values(QUERY_LANGUAGE_REGISTRY)) {
      expect(supportDocs).toContain(`\`${metadata.id}\``);
      expect(supportDocs).toContain(`\`${metadata.lifecycle}\``);
      expect(supportDocs).toContain(metadata.parserOwner);
      expect(supportDocs).toContain(metadata.completionOwner);
      expect(supportDocs).toContain(metadata.fallbackPolicy.kind);
      expect(supportDocs).toContain(metadata.safetyAnalyzer);
    }
  });

  it("keeps enterprise SQL runtime slices scoped", () => {
    const supportDocs = readDocs(
      "docs/product",
      "docs/ROADMAP.md",
      "docs/roadmap",
    );

    expect(supportDocs).toMatch(
      /\bMSSQL\b[\s\S]*catalog\/query\/cancel\/tabular runtime/i,
    );
    expect(supportDocs).toMatch(
      /\bOracle\b[\s\S]*catalog\/query\/cancel\/tabular runtime/i,
    );
    expect(supportDocs).toMatch(
      /#907 Runtime Happy Path smoke covers representative connect, seeded catalog browse, SELECT\/DML, destructive Safe Mode confirmation, cancellation, and grid edit/,
    );
    expect(supportDocs).toMatch(
      /Full Oracle SQL parser\/completion promotion remains unclaimed/,
    );
    expect(supportDocs).toMatch(
      /#907 Runtime Happy Path smoke covers representative service-name connect, seeded catalog\/routine browse, SELECT\/DML, destructive Safe Mode confirmation, cancellation, and grid edit/,
    );

    for (const pattern of ACTIVE_CLAIM_PATTERNS) {
      expect(supportDocs).not.toMatch(pattern);
    }
  });

  // Reason: the over-600-code-point line cleanup pulls this prose out of wide
  // table cells into ~80-column paragraphs, which collapses a line-bounded
  // guard window to a single wrapped line. Nothing is broken today (the corpus
  // maximum is still set by unconverted files), so this pins the forward case.
  // Raised as a non-blocking finding in the review of PR #1841 (2026-07-26).
  it("catches an enterprise overclaim split across a re-flowed line break", () => {
    const reflowed =
      "Oracle 워크벤치 프로파일은 raw DDL/admin\nsupport is active 로 승격되었다.\n";

    // Line-bounded matching (pre-fix corpus shape) never sees the claim.
    expect(matchesAnyActiveClaim(reflowed)).toBe(false);
    expect(matchesAnyActiveClaim(normalizeDocProse(reflowed))).toBe(true);

    // A blank line stays a hard bound: two paragraphs are not one claim.
    const twoParagraphs = reflowed.replace("\n", "\n\n");
    expect(matchesAnyActiveClaim(normalizeDocProse(twoParagraphs))).toBe(false);
  });

  it("documents current connection support and dedicated DBMS form owners", () => {
    const productDocs = readFileSync("docs/product/README.md", "utf8");

    expect(SUPPORTED_DATABASE_TYPES).toHaveLength(12);
    expect(productDocs).toContain("getConnectionSupportedDatabaseTypes");
    expect(productDocs).toContain("isConnectionSupportedDatabaseType");
    expect(productDocs).toContain("SUPPORTED_DATABASE_TYPES");
    expect(productDocs).toContain("12개 allow-list");

    for (const formComponent of [
      "PgFormFields",
      "MysqlFormFields",
      "MssqlFormFields",
      "OracleFormFields",
      "SearchFormFields",
      "MongoFormFields",
      "RedisFormFields",
      "SqliteFormFields",
    ]) {
      expect(productDocs).toContain(formComponent);
    }

    expect(productDocs).toContain(
      "MSSQL/Oracle/Search 는 Pg form reuse claim 을 하지 않는다.",
    );
    expect(productDocs).toMatch(/line-number references are\s+not stable SOT/);
  });

  it("keeps Search fixture contracts separate from live runtime evidence", () => {
    const productDocs = readDocs("docs/product");

    expect(productDocs).toMatch(/Search fixture files.*contract evidence/i);
    expect(productDocs).toMatch(
      /Elasticsearch\/OpenSearch Runtime Happy Path smoke.*live runtime evidence/i,
    );
    expect(productDocs).toMatch(
      /fixture files.*contract evidence.*do not promote unwired Search paths/i,
    );
  });
});
