import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { QUERY_LANGUAGE_REGISTRY } from "./queryLanguage";

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

  it("keeps MSSQL connection-only while Oracle stays declared-only", () => {
    const supportDocs = [
      "docs/product/README.md",
      "docs/product/known-limitations.md",
      "docs/product/query-language-support.md",
      "docs/ROADMAP.md",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(supportDocs).toMatch(/\bMSSQL\b[\s\S]*connection-only/i);
    expect(supportDocs).toMatch(/\bOracle\b[\s\S]*declared-only/i);
    expect(supportDocs).toMatch(
      /No SQL Server query, catalog, edit, DDL, parser, completion, or runtime smoke support is claimed/,
    );
    expect(supportDocs).toMatch(
      /No Oracle connection, query, catalog, edit, DDL, parser, completion, or runtime smoke support is claimed/,
    );

    const activeClaimPatterns = [
      /\bMSSQL\b[^.\n|]*(?:has query\/catalog\/edit runtime support|Runtime Happy Path smoke covers|RelationalCatalog, RelationalQuery)/i,
      /\bOracle\b[^.\n|]*(?:now has|has UI\/runtime support|connection-test runtime evidence|service-name connection UI\/runtime support|Runtime Happy Path smoke covers|RelationalCatalog, RelationalQuery)/i,
      /SQL Server query, seeded/i,
      /Oracle service-name connect, seeded/i,
      /\bMSSQL\b[^.\n|]*catalog-aware[^.\n|]*completion is active/i,
      /\bOracle\b[^.\n|]*autocomplete is active/i,
    ];

    for (const pattern of activeClaimPatterns) {
      expect(supportDocs).not.toMatch(pattern);
    }
  });
});
