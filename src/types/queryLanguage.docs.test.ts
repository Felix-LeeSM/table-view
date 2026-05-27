import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getActiveQueryLanguages,
  getQueryLanguageMetadata,
} from "./queryLanguage";

describe("query language support documentation", () => {
  it("documents every active query language ownership record", () => {
    const supportDocs = readFileSync(
      "docs/reference/query-language-support.md",
      "utf8",
    );

    for (const languageId of getActiveQueryLanguages()) {
      const metadata = getQueryLanguageMetadata(languageId);

      expect(supportDocs).toContain(`\`${languageId}\``);
      expect(supportDocs).toContain(metadata.parserOwner);
      expect(supportDocs).toContain(metadata.completionOwner);
      expect(supportDocs).toContain(metadata.fallbackPolicy.kind);
    }
  });
});
