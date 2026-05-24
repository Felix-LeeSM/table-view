import { describe, expect, it } from "vitest";
import { DATABASE_TYPE_LABELS, type DatabaseType } from "./connection";
import {
  ADAPTER_CONFORMANCE_MATRIX,
  CONFORMANCE_CHECKS,
  getAdapterConformanceMatrix,
} from "./adapterConformance";

describe("adapter conformance matrix", () => {
  const allDatabaseTypes = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

  it("requires every DatabaseType to choose conformance levels", () => {
    expect(Object.keys(ADAPTER_CONFORMANCE_MATRIX).sort()).toEqual(
      [...allDatabaseTypes].sort(),
    );
  });

  it("maps support claims to check ids and makes unsupported areas explicit", () => {
    const checkIds = new Set(CONFORMANCE_CHECKS.map((check) => check.id));

    for (const dbType of allDatabaseTypes) {
      const claims = ADAPTER_CONFORMANCE_MATRIX[dbType];

      for (const claim of Object.values(claims.areas)) {
        if (claim.level === "unsupported") {
          expect(
            claim.unsupported.length,
            `${dbType}:${claim.area}`,
          ).toBeGreaterThan(0);
          expect(claim.checks).toEqual([]);
          continue;
        }

        expect(claim.checks.length, `${dbType}:${claim.area}`).toBeGreaterThan(
          0,
        );
        for (const checkId of claim.checks) {
          expect(
            checkIds.has(checkId),
            `${dbType}:${claim.area}:${checkId}`,
          ).toBe(true);
        }
      }
    }
  });

  it("runs a focused pilot against one RDBMS and one non-RDBMS adapter family", () => {
    expect(
      getAdapterConformanceMatrix({
        dbTypes: ["postgresql", "mongodb"],
        areas: ["profile", "query", "catalog"],
      }).map((entry) => entry.dbType),
    ).toEqual(["postgresql", "mongodb"]);
  });
});
