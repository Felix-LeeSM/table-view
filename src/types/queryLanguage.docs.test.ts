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

  it("keeps enterprise SQL runtime slices scoped", () => {
    const supportDocs = [
      "docs/product/README.md",
      "docs/product/known-limitations.md",
      "docs/product/query-language-support.md",
      "docs/ROADMAP.md",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(supportDocs).toMatch(
      /\bMSSQL\b[\s\S]*catalog\/query\/cancel\/tabular runtime/i,
    );
    expect(supportDocs).toMatch(
      /\bOracle\b[\s\S]*catalog\/query\/cancel\/tabular runtime/i,
    );
    expect(supportDocs).toMatch(
      /SQL Server structured DDL, admin\/security\/backup\/jobs\/users\/roles, broad parser\/completion semantics, and runtime smoke support remain unclaimed/,
    );
    expect(supportDocs).toMatch(
      /Oracle SQL parser\/completion promotion remains unclaimed/,
    );
    expect(supportDocs).toMatch(
      /#905 does not enable editRows, switch database, structured DDL, raw DDL\/admin, PL\/SQL body\/package authoring\/source, trigger catalog/,
    );

    const activeClaimPatterns = [
      /\bMSSQL\b[^.\n|]*(?:Runtime Happy Path smoke covers|catalog-aware[^.\n|]*completion is active|structured DDL is active)/i,
      /\bOracle\b[^.\n|]*(?:Runtime Happy Path smoke covers|routine smoke is active|routine smoke support is active)/i,
      /\bOracle\b[^.\n|]*(?:editRows|structured DDL|raw DDL\/admin|parser\/completion|PL\/SQL)[^.\n|]*(?:is active|is supported|runtime support is active|support is active)/i,
      /SQL Server smoke, seeded/i,
      /Oracle service-name connect, seeded/i,
      /\bOracle\b[^.\n|]*autocomplete is active/i,
    ];

    for (const pattern of activeClaimPatterns) {
      expect(supportDocs).not.toMatch(pattern);
    }
  });
});
