import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("fixture stack wiring", () => {
  it("keeps docker-compose.yml parseable with the MSSQL healthcheck", () => {
    const compose = parse(readFileSync(resolve("docker-compose.yml"), "utf8"));
    expect(compose?.services?.mssql?.healthcheck?.test).toEqual(
      expect.arrayContaining(["CMD-SHELL"]),
    );
  });

  it("loads the fixture CLI for a non-DuckDB target", () => {
    const out = execFileSync(
      "pnpm",
      [
        "exec",
        "tsx",
        "scripts/fixtures/index.ts",
        "generate",
        "e2e",
        "--target",
        "sqlite",
      ],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(out).toContain("# db:generate e2e (target=sqlite)");
  });
});
