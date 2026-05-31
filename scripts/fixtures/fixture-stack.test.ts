import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("fixture stack wiring", () => {
  it("starts every compose fixture service from db:up", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts["db:up"]).toBe(
      "docker compose up -d && ./scripts/db/wait.sh",
    );
  });

  it("waits for every compose fixture container", () => {
    const compose = parse(readFileSync(resolve("docker-compose.yml"), "utf8"));
    const waitScript = readFileSync(resolve("scripts/db/wait.sh"), "utf8");
    const services = Object.values(compose?.services ?? {}) as Array<{
      container_name?: string;
    }>;

    for (const service of services) {
      expect(service.container_name).toBeTruthy();
      expect(waitScript).toContain(service.container_name);
    }
  });

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
