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
            claim.unsupported.length + claim.deferred.length,
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

  it("keeps MariaDB catalog promotion tied to MariaDB evidence, not MySQL context", () => {
    const [mariadbWithOnlyMysqlVersion] = getAdapterConformanceMatrix({
      dbTypes: ["mariadb"],
      areas: ["catalog"],
      versionContext: {
        mysql: "8.0.16",
      },
    });

    expect(mariadbWithOnlyMysqlVersion?.areas.catalog?.checks).not.toContain(
      "catalog.constraints",
    );
    expect(mariadbWithOnlyMysqlVersion?.areas.catalog?.deferred).toContain(
      "catalog.constraints",
    );

    const [mariadbWithMariaDbVersion] = getAdapterConformanceMatrix({
      dbTypes: ["mariadb"],
      areas: ["catalog"],
      versionContext: {
        mariadb: "10.2.1-MariaDB",
      },
    });

    expect(mariadbWithMariaDbVersion?.areas.catalog?.checks).toContain(
      "catalog.constraints",
    );
  });

  it("locks MariaDB catalog/workbench parity scope to version-aware CHECK context", () => {
    const [mariadbWithoutVersion] = getAdapterConformanceMatrix({
      dbTypes: ["mariadb"],
      areas: ["catalog"],
    });

    expect(mariadbWithoutVersion?.areas.catalog?.checks).toEqual(
      expect.arrayContaining([
        "catalog.browse",
        "catalog.schema",
        "catalog.indexes",
        "catalog.relationships",
      ]),
    );
    expect(mariadbWithoutVersion?.areas.catalog?.deferred).toContain(
      "catalog.constraints",
    );

    const [mariadbWithVersion] = getAdapterConformanceMatrix({
      dbTypes: ["mariadb"],
      areas: ["catalog"],
      versionContext: {
        mariadb: "10.11.8-MariaDB",
      },
    });

    expect(mariadbWithVersion?.areas.catalog?.checks).toEqual(
      expect.arrayContaining([
        "catalog.browse",
        "catalog.schema",
        "catalog.indexes",
        "catalog.relationships",
        "catalog.constraints",
      ]),
    );
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

  it("locks the Valkey runtime claim to connection, db switching, key browsing, and command query", () => {
    const valkey = ADAPTER_CONFORMANCE_MATRIX.valkey;

    expect(valkey.level).toBe("runtime");
    expect(valkey.areas.connection.checks).toEqual([
      "connection.test",
      "connection.switchDatabase",
    ]);
    expect(valkey.areas.connection.deferred).toEqual([]);
    expect(valkey.areas.connection.unsupported).toEqual([
      "connection.readOnly",
      "connection.filePicker",
    ]);
    expect(valkey.areas.catalog.checks).toEqual(["catalog.browse"]);
    expect(valkey.areas.catalog.deferred).toEqual([
      "catalog.schema",
      "catalog.indexes",
      "catalog.relationships",
    ]);
    expect(valkey.areas.query.checks).toEqual(["query.query"]);
    expect(valkey.areas.query.deferred).toEqual([
      "query.cancel",
      "query.explain",
    ]);
    expect(valkey.areas.edit.checks).toEqual([]);
    expect(valkey.areas.edit.deferred).toEqual([
      "edit.editKeys",
      "edit.bulkWrite",
    ]);
  });

  it("locks MSSQL catalog/workbench metadata while keeping edit and explain deferred", () => {
    const mssql = ADAPTER_CONFORMANCE_MATRIX.mssql;

    expect(mssql.level).toBe("runtime");
    expect(mssql.areas.connection.checks).toEqual([
      "connection.test",
      "connection.switchDatabase",
    ]);
    expect(mssql.areas.connection.deferred).toEqual([]);
    expect(mssql.areas.catalog.checks).toEqual([
      "catalog.browse",
      "catalog.schema",
      "catalog.indexes",
      "catalog.constraints",
      "catalog.relationships",
    ]);
    expect(mssql.areas.catalog.deferred).toEqual([]);
    expect(mssql.areas.query.checks).toEqual([
      "query.query",
      "query.multiStatement",
      "query.cancel",
    ]);
    expect(mssql.areas.query.deferred).toEqual(["query.explain"]);
    expect(mssql.areas.edit.checks).toEqual([]);
    expect(mssql.areas.edit.deferred).toEqual(["edit.editRows"]);
  });

  it("locks Oracle to lifecycle-only conformance", () => {
    const oracle = ADAPTER_CONFORMANCE_MATRIX.oracle;

    expect(oracle.level).toBe("runtime");
    expect(oracle.areas.connection.checks).toEqual(["connection.test"]);
    expect(oracle.areas.connection.deferred).toEqual([
      "connection.switchDatabase",
    ]);
    expect(oracle.areas.connection.unsupported).toEqual([
      "connection.readOnly",
      "connection.filePicker",
    ]);
    expect(oracle.areas.catalog.checks).toEqual([]);
    expect(oracle.areas.catalog.deferred).toEqual([
      "catalog.browse",
      "catalog.schema",
    ]);
    expect(oracle.areas.query.checks).toEqual([]);
    expect(oracle.areas.query.deferred).toEqual([
      "query.query",
      "query.cancel",
      "query.explain",
    ]);
    expect(oracle.areas.edit.checks).toEqual([]);
    expect(oracle.areas.edit.deferred).toEqual(["edit.editRows"]);
  });
});
