import { describe, expect, it } from "vitest";
import { shouldRunTarget, targetMode } from "./target-selection.js";

describe("fixture target selection", () => {
  it("keeps default/all aligned with pnpm db:up plus local file targets", () => {
    const target = targetMode({});

    expect(target).toBe("all");
    expect(shouldRunTarget(target, "pg")).toBe(true);
    expect(shouldRunTarget(target, "mongo")).toBe(true);
    expect(shouldRunTarget(target, "mysql")).toBe(true);
    expect(shouldRunTarget(target, "sqlite")).toBe(true);
    expect(shouldRunTarget(target, "duckdb")).toBe(true);
    expect(shouldRunTarget(target, "mariadb")).toBe(false);
    expect(shouldRunTarget(target, "mssql")).toBe(false);
    expect(shouldRunTarget(target, "oracle")).toBe(false);
    expect(shouldRunTarget(target, "redis")).toBe(false);
  });

  it("keeps optional network targets explicit", () => {
    expect(targetMode({ target: "mssql" })).toBe("mssql");
    expect(shouldRunTarget("mssql", "mssql")).toBe(true);
    expect(shouldRunTarget("mssql", "pg")).toBe(false);
  });
});
