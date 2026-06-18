import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkDocLinks,
  collectActiveDocSources,
  collectMarkdownAnchors,
} from "../check-doc-links";

function withFixture(
  files: Record<string, string>,
  run: (cwd: string) => void,
) {
  const cwd = mkdtempSync(join(tmpdir(), "table-view-doc-links-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      const fullPath = join(cwd, path);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content);
    }
    run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("collectActiveDocSources", () => {
  it("includes active docs and excludes archives and sprints as source roots", () => {
    withFixture(
      {
        "README.md": "[product](docs/product/README.md)",
        "docs/ROADMAP.md": "[guide](contributor-guide/testing-and-quality.md)",
        "docs/product/README.md": "[archive](../archives/README.md)",
        "docs/contributor-guide/testing-and-quality.md": "# Quality",
        "docs/archives/README.md": "[missing](missing.md)",
        "docs/sprints/sprint-1/contract.md": "[missing](missing.md)",
      },
      (cwd) => {
        expect(collectActiveDocSources(cwd)).toEqual([
          "README.md",
          "docs/ROADMAP.md",
          "docs/contributor-guide/testing-and-quality.md",
          "docs/product/README.md",
        ]);
      },
    );
  });
});

describe("collectMarkdownAnchors", () => {
  it("matches GitHub heading slugs and duplicate suffixes", () => {
    const anchors = collectMarkdownAnchors(`# Hello, World!\n## Hello World\n`);
    expect(anchors.has("hello-world")).toBe(true);
    expect(anchors.has("hello-world-1")).toBe(true);
  });

  it("includes explicit html ids", () => {
    const anchors = collectMarkdownAnchors(`<a id="custom-anchor"></a>`);
    expect(anchors.has("custom-anchor")).toBe(true);
  });
});

describe("checkDocLinks", () => {
  it("accepts active-doc links into excluded directories when targets resolve", () => {
    withFixture(
      {
        "README.md": "[archive](docs/archives/README.md#historical)",
        "docs/ROADMAP.md": "# Roadmap",
        "docs/product/README.md": "[sprint](../sprints/sprint-1/contract.md)",
        "docs/contributor-guide/testing-and-quality.md": "# Quality",
        "docs/archives/README.md": "# Historical",
        "docs/sprints/sprint-1/contract.md": "# Contract",
      },
      (cwd) => {
        const result = checkDocLinks(cwd);
        expect(result.issues).toEqual([]);
        expect(result.linksChecked).toBe(2);
      },
    );
  });

  it("reports source, target, and reason for missing files", () => {
    withFixture(
      {
        "README.md": "[missing](docs/product/missing.md)",
        "docs/ROADMAP.md": "# Roadmap",
        "docs/product/README.md": "# Product",
        "docs/contributor-guide/testing-and-quality.md": "# Quality",
      },
      (cwd) => {
        expect(checkDocLinks(cwd).issues).toEqual([
          {
            source: "README.md",
            line: 1,
            target: "docs/product/missing.md",
            reason: "missing target docs/product/missing.md",
          },
        ]);
      },
    );
  });

  it("reports missing anchors in markdown targets", () => {
    withFixture(
      {
        "README.md": "[bad anchor](docs/product/README.md#missing)",
        "docs/ROADMAP.md": "# Roadmap",
        "docs/product/README.md": "# Present",
        "docs/contributor-guide/testing-and-quality.md": "# Quality",
      },
      (cwd) => {
        expect(checkDocLinks(cwd).issues[0]).toMatchObject({
          source: "README.md",
          target: "docs/product/README.md#missing",
          reason: "missing anchor #missing in docs/product/README.md",
        });
      },
    );
  });

  it("ignores fenced code and external links", () => {
    withFixture(
      {
        "README.md":
          "```md\n[missing](docs/product/missing.md)\n```\n[external](https://example.com)",
        "docs/ROADMAP.md": "# Roadmap",
        "docs/product/README.md": "# Product",
        "docs/contributor-guide/testing-and-quality.md": "# Quality",
      },
      (cwd) => {
        expect(checkDocLinks(cwd).issues).toEqual([]);
        expect(checkDocLinks(cwd).linksChecked).toBe(0);
      },
    );
  });
});
