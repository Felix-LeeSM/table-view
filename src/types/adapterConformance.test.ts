import { describe, expect, it } from "vitest";
import { DATABASE_TYPE_LABELS, type DatabaseType } from "./connection";
import {
  ADAPTER_CONFORMANCE_MATRIX,
  CONFORMANCE_CHECKS,
  type ConformanceArea,
  getAdapterConformanceMatrix,
} from "./adapterConformance";
import {
  getDataSourceProfile,
  type DataSourceCapabilities,
} from "./dataSource";

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

  it("maps every profile capability flag to a conformance decision", () => {
    const capabilityAreas = {
      connection: "connection",
      catalog: "catalog",
      query: "query",
      edit: "edit",
    } as const satisfies Readonly<
      Record<
        Extract<ConformanceArea, "connection" | "catalog" | "query" | "edit">,
        keyof DataSourceCapabilities
      >
    >;

    for (const dbType of allDatabaseTypes) {
      const profile = getDataSourceProfile(dbType);
      const conformance = ADAPTER_CONFORMANCE_MATRIX[dbType];

      for (const [area, group] of Object.entries(capabilityAreas) as [
        keyof typeof capabilityAreas,
        keyof DataSourceCapabilities,
      ][]) {
        const claim = conformance.areas[area];

        for (const [name, supported] of Object.entries(
          profile.capabilities[group],
        )) {
          const checkId = `${group}.${name}`;

          if (supported) {
            expect(claim.checks, `${dbType}:${checkId}`).toContain(checkId);
          } else {
            expect(
              [...claim.unsupported, ...claim.deferred],
              `${dbType}:${checkId}`,
            ).toContain(checkId);
          }
        }
      }
    }
  });

  it("runs a focused pilot against one RDBMS and one non-RDBMS adapter family", () => {
    const focused = getAdapterConformanceMatrix({
      dbTypes: ["postgresql", "mongodb"],
      areas: ["profile", "query", "catalog"],
    });

    expect(focused.map((entry) => entry.dbType)).toEqual([
      "postgresql",
      "mongodb",
    ]);
    const firstFocusedEntry = focused[0];
    expect(firstFocusedEntry).toBeDefined();
    expect(Object.keys(firstFocusedEntry?.areas ?? {})).toEqual([
      "profile",
      "query",
      "catalog",
    ]);
  });
});
