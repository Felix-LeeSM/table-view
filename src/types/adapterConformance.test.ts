import { describe, expect, it } from "vitest";
import { DATABASE_TYPE_LABELS, type DatabaseType } from "./connection";
import {
  ADAPTER_CONFORMANCE_MATRIX,
  CONFORMANCE_CHECKS,
  type ConformanceArea,
  getAdapterConformanceMatrix,
} from "./adapterConformance";
import { type DataSourceCapabilities } from "./dataSource";
import { getVersionAwareDataSourceCapabilities } from "./dataSourceVersionCapabilities";

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

  it("maps every version-aware capability flag to a conformance decision", () => {
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
      const capabilities = getVersionAwareDataSourceCapabilities(dbType);
      const conformance = ADAPTER_CONFORMANCE_MATRIX[dbType];

      for (const [area, group] of Object.entries(capabilityAreas) as [
        keyof typeof capabilityAreas,
        keyof DataSourceCapabilities,
      ][]) {
        const claim = conformance.areas[area];

        for (const [name, supported] of Object.entries(capabilities[group])) {
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

  it("keeps MySQL-family constraint catalog claims behind server-version context", () => {
    expect(ADAPTER_CONFORMANCE_MATRIX.mysql.areas.catalog.checks).not.toContain(
      "catalog.constraints",
    );
    expect(ADAPTER_CONFORMANCE_MATRIX.mysql.areas.catalog.deferred).toContain(
      "catalog.constraints",
    );
    expect(
      ADAPTER_CONFORMANCE_MATRIX.mariadb.areas.catalog.checks,
    ).not.toContain("catalog.constraints");
    expect(ADAPTER_CONFORMANCE_MATRIX.mariadb.areas.catalog.deferred).toContain(
      "catalog.constraints",
    );

    const [mysql, mariadb] = getAdapterConformanceMatrix({
      dbTypes: ["mysql", "mariadb"],
      areas: ["catalog"],
      versionContext: {
        mysql: "8.0.16",
        mariadb: "10.2.1-MariaDB",
      },
    });

    expect(mysql?.areas.catalog?.checks).toContain("catalog.constraints");
    expect(mariadb?.areas.catalog?.checks).toContain("catalog.constraints");
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

  it("locks the MongoDB integration-gate support claim to tested workflow areas", () => {
    const mongo = ADAPTER_CONFORMANCE_MATRIX.mongodb;

    expect(mongo.level).toBe("runtime");
    expect(mongo.areas.connection.checks).toEqual(["connection.test"]);
    expect(mongo.areas.catalog.checks).toEqual([
      "catalog.browse",
      "catalog.schema",
      "catalog.indexes",
    ]);
    expect(mongo.areas.query.checks).toEqual([
      "query.query",
      "query.cancel",
      "query.explain",
    ]);
    expect(mongo.areas.result.checks).toEqual(["result.envelope"]);
    expect(mongo.areas.edit.checks).toEqual([
      "edit.editDocuments",
      "edit.bulkWrite",
    ]);
    expect(mongo.areas.safety.checks).toEqual(["safety.policy"]);
    expect(mongo.areas.query.deferred).toEqual(["query.multiStatement"]);
    expect(mongo.areas.edit.deferred).toEqual([
      "edit.editRows",
      "edit.editKeys",
    ]);
  });
});
