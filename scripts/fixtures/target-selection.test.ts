import { describe, expect, it } from "vitest";
import { shouldRunTarget, targetMode } from "./target-selection.js";

describe("fixture target selection", () => {
  it("keeps default/all aligned with active fixture connection targets", () => {
    const target = targetMode({});

    expect(target).toBe("all");
    expect(shouldRunTarget(target, "pg")).toBe(true);
    expect(shouldRunTarget(target, "mongo")).toBe(true);
    expect(shouldRunTarget(target, "mysql")).toBe(true);
    expect(shouldRunTarget(target, "sqlite")).toBe(true);
    expect(shouldRunTarget(target, "duckdb")).toBe(true);
    expect(shouldRunTarget(target, "mariadb")).toBe(true);
    expect(shouldRunTarget(target, "mssql")).toBe(true);
    expect(shouldRunTarget(target, "oracle")).toBe(true);
    expect(shouldRunTarget(target, "redis")).toBe(true);
  });

  it("keeps explicit targets scoped to the requested backend", () => {
    expect(targetMode({ target: "mariadb" })).toBe("mariadb");
    expect(shouldRunTarget("mariadb", "mariadb")).toBe(true);
    expect(shouldRunTarget("mariadb", "pg")).toBe(false);

    expect(targetMode({ target: "mssql" })).toBe("mssql");
    expect(shouldRunTarget("mssql", "mssql")).toBe(true);
    expect(shouldRunTarget("mssql", "pg")).toBe(false);

    expect(targetMode({ target: "oracle" })).toBe("oracle");
    expect(shouldRunTarget("oracle", "oracle")).toBe(true);
    expect(shouldRunTarget("oracle", "pg")).toBe(false);
  });
});
