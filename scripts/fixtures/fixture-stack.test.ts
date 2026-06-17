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

  it("removes compose fixture volumes from db:down", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts["db:down"]).toBe("docker compose down -v");
  });

  it("exposes semantic fixture script aliases without removing legacy db scripts", () => {
    const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(pkg.scripts["fixtures:load"]).toBe(
      "tsx scripts/fixtures/index.ts load",
    );
    expect(pkg.scripts["fixtures:rebuild"]).toBe(
      "tsx scripts/fixtures/index.ts rebuild",
    );
    expect(pkg.scripts["fixtures:preview"]).toBe(
      "tsx scripts/fixtures/index.ts preview",
    );
    expect(pkg.scripts["fixtures:register-connections"]).toBe(
      "tsx scripts/fixtures/index.ts register-connections",
    );
    expect(pkg.scripts["fixtures:clear-connections"]).toBe(
      "tsx scripts/fixtures/index.ts clear-connections",
    );
    expect(pkg.scripts["db:seed"]).toBe("tsx scripts/fixtures/index.ts seed");
    expect(pkg.scripts["db:generate"]).toBe(
      "tsx scripts/fixtures/index.ts generate",
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

  it("seeds Redis after the Redis fixture is ready", () => {
    const waitScript = readFileSync(resolve("scripts/db/wait.sh"), "utf8");

    expect(waitScript).toContain('check_container "table_view_redis" "redis"');
    expect(waitScript).toContain(
      "pnpm fixtures:load development --target redis --quiet",
    );
  });

  it("keeps docker-compose.yml parseable with the MSSQL healthcheck", () => {
    const compose = parse(readFileSync(resolve("docker-compose.yml"), "utf8"));
    expect(compose?.services?.mssql?.healthcheck?.test).toEqual(
      expect.arrayContaining(["CMD-SHELL"]),
    );
  });

  it("loads every active localhost runtime fixture from the E2E seed-smoke default", () => {
    const seedSmoke = readFileSync(resolve("e2e/fixtures/seed-smoke.ts"), {
      encoding: "utf8",
    });
    const allTargets = seedSmoke.match(
      /const ALL_SEED_TARGETS = \[([\s\S]*?)\] as const/,
    )?.[1];

    expect(allTargets).toContain('"mariadb"');
    expect(allTargets).toContain('"mssql"');
    expect(allTargets).toContain('"oracle"');
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

    expect(out).toContain("# fixtures:preview e2e (target=sqlite)");
  }, 45_000);
});
