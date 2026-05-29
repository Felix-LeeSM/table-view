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
});
