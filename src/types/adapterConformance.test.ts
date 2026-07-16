import { describe, expect, it } from "vitest";
import { DATABASE_TYPE_LABELS, type DatabaseType } from "./connection";
import {
  ADAPTER_CONFORMANCE_MATRIX,
  CONFORMANCE_CHECKS,
  type ConformanceArea,
  getAdapterConformanceMatrix,
} from "./adapterConformance";
import {
  ADAPTER_CONTRACT_TEST_DATABASE_TYPES,
  ADAPTER_CONTRACT_TEST_MATRIX,
  type AdapterContractTestArea,
  type AdapterContractTestJudgement,
} from "./adapterContractTestMatrix";
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

  it("keeps profile presence separate from runtime support claims", () => {
    for (const dbType of allDatabaseTypes) {
      const conformance = ADAPTER_CONFORMANCE_MATRIX[dbType];
      const capabilities = getVersionAwareDataSourceCapabilities(dbType);
      const hasRuntimeWorkflow =
        Object.values(capabilities.catalog).some(Boolean) ||
        Object.values(capabilities.query).some(Boolean) ||
        Object.values(capabilities.edit).some(Boolean) ||
        Object.values(capabilities.ddl).some(Boolean);

      expect(conformance.areas.profile.level).toBe("declared");
      expect(conformance.areas.profile.checks).toEqual([
        "profile.registry",
        "profile.identity",
        "profile.backendAdapter",
        "profile.dialect",
      ]);
      expect(conformance.level).toBe(
        hasRuntimeWorkflow
          ? "runtime"
          : capabilities.connection.test
            ? "contract"
            : "declared",
      );
    }
  });

  it("maps every version-aware capability flag to a conformance decision", () => {
    const capabilityAreas = {
      connection: "connection",
      catalog: "catalog",
      query: "query",
      edit: "edit",
      ddl: "ddl",
    } as const satisfies Readonly<
      Record<
        Extract<
          ConformanceArea,
          "connection" | "catalog" | "query" | "edit" | "ddl"
        >,
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

          // Issue #1356 — `edit.requiresPrimaryKeyForEdit` is a write-safety
          // constraint, not a support claim, so it is intentionally absent from
          // the conformance buckets.
          if (checkId === "edit.requiresPrimaryKeyForEdit") continue;

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
      expect.arrayContaining(["catalog.indexes"]),
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
      expect.arrayContaining(["catalog.indexes", "catalog.constraints"]),
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
    expect(mongo.areas.catalog.checks).toEqual(["catalog.indexes"]);
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
    expect(mongo.areas.query.deferred).toEqual([]);
    expect(mongo.areas.edit.deferred).toEqual([
      "edit.editRows",
      "edit.editKeys",
    ]);
  });

  it("locks the Valkey runtime claim to bounded key browsing, command query, and key edits", () => {
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
    expect(valkey.areas.catalog.checks).toEqual([]);
    expect(valkey.areas.catalog.deferred).toEqual(["catalog.indexes"]);
    // Issue #1269 (gap #6) — cooperative cancel is a live claim, not deferred.
    expect(valkey.areas.query.checks).toEqual(["query.query", "query.cancel"]);
    expect(valkey.areas.query.deferred).toEqual(["query.explain"]);
    expect(valkey.areas.edit.checks).toEqual(["edit.editKeys"]);
    expect(valkey.areas.edit.deferred).toEqual(["edit.bulkWrite"]);
  });

  it("claims MSSQL structured DDL after #1071 alongside catalog/query/edit", () => {
    const mssql = ADAPTER_CONFORMANCE_MATRIX.mssql;

    expect(mssql.level).toBe("runtime");
    expect(mssql.areas.connection.checks).toEqual(["connection.test"]);
    expect(mssql.areas.catalog.checks).toEqual([
      "catalog.indexes",
      "catalog.constraints",
    ]);
    expect(mssql.areas.query.checks).toEqual(["query.query", "query.cancel"]);
    expect(mssql.areas.edit.checks).toEqual(["edit.editRows"]);
    expect(mssql.areas.ddl.checks).toEqual([
      "ddl.createTable",
      "ddl.alterTable",
      "ddl.createIndex",
      "ddl.dropObject",
    ]);
    expect(mssql.areas.connection.unsupported).toEqual([
      "connection.switchDatabase",
      "connection.readOnly",
      "connection.filePicker",
    ]);
    expect(mssql.areas.catalog.unsupported).toEqual([]);
    expect(mssql.areas.query.unsupported).toEqual(["query.explain"]);
    expect(mssql.areas.query.deferred).toEqual([]);
    expect(mssql.areas.edit.unsupported).toEqual([
      "edit.editDocuments",
      "edit.editKeys",
      "edit.bulkWrite",
    ]);
    expect(mssql.areas.ddl.unsupported).toEqual([]);
  });

  it("keeps Oracle scoped to catalog/query/edit runtime without DDL claims", () => {
    const oracle = ADAPTER_CONFORMANCE_MATRIX.oracle;

    expect(oracle.level).toBe("runtime");
    expect(oracle.areas.connection.checks).toEqual(["connection.test"]);
    expect(oracle.areas.catalog.checks).toEqual([
      "catalog.indexes",
      "catalog.constraints",
    ]);
    expect(oracle.areas.query.checks).toEqual(["query.query", "query.cancel"]);
    expect(oracle.areas.edit.checks).toEqual(["edit.editRows"]);
    expect(oracle.areas.ddl.checks).toEqual([]);
    expect(oracle.areas.connection.deferred).toEqual([]);
    expect(oracle.areas.connection.unsupported).toEqual([
      "connection.switchDatabase",
      "connection.readOnly",
      "connection.filePicker",
    ]);
    expect(oracle.areas.catalog.unsupported).toEqual([]);
    expect(oracle.areas.query.unsupported).toEqual(["query.explain"]);
    expect(oracle.areas.query.deferred).toEqual([]);
    expect(oracle.areas.edit.unsupported).toEqual([
      "edit.editDocuments",
      "edit.editKeys",
      "edit.bulkWrite",
    ]);
    expect(oracle.areas.ddl.unsupported).toEqual([
      "ddl.createTable",
      "ddl.alterTable",
      "ddl.createIndex",
      "ddl.dropObject",
    ]);
  });

  it("keeps engines runtime via query after #1464 emptied their catalog claim", () => {
    // #1464 — deleting the non-discriminating `catalog.browse` / `catalog.schema`
    // flags empties the catalog claim for the engines that declared only those
    // two (redis/valkey: browse). The entry `level` must stay `runtime` because
    // it is driven by the query workflow, not the catalog claim — this locks
    // that the flag cleanup causes no conformance regression.
    // (duckdb left this group when #1070 landed real `catalog.indexes` /
    // `catalog.constraints` claims — asserted separately below.)
    for (const dbType of ["redis", "valkey"] as const) {
      const entry = ADAPTER_CONFORMANCE_MATRIX[dbType];
      expect(entry.level).toBe("runtime");
      expect(entry.areas.catalog.checks).toEqual([]);
      expect(entry.areas.query.checks).toContain("query.query");
    }
    const duckdb = ADAPTER_CONFORMANCE_MATRIX.duckdb;
    expect(duckdb.level).toBe("runtime");
    expect(duckdb.areas.catalog.checks).toEqual([
      "catalog.indexes",
      "catalog.constraints",
    ]);
    expect(duckdb.areas.query.checks).toContain("query.query");
  });
});

describe("adapter contract test matrix", () => {
  const allDatabaseTypes = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

  it("maps #745 contract areas to their child issue owners", () => {
    const areaOwners = ADAPTER_CONTRACT_TEST_MATRIX.map((row) => [
      row.area,
      row.childIssue,
    ]);

    expect(areaOwners).toEqual([
      ["query", 765],
      ["result", 765],
      ["catalog", 766],
      ["explain", 766],
      ["completion", 767],
      ["safety", 768],
    ]);
    expect(new Set(areaOwners.map(([area]) => area)).size).toBe(
      areaOwners.length,
    );
    for (const [, childIssue] of areaOwners) {
      expect([765, 766, 767, 768]).toContain(childIssue);
    }
  });

  it("keeps common judgement separate from DBMS delta templates", () => {
    const ids = new Set<string>();
    const allowedJudgements = new Set([
      "common",
      "dbms-delta",
      "unsupported-delta",
      "deferred",
    ] satisfies AdapterContractTestJudgement[]);

    for (const row of ADAPTER_CONTRACT_TEST_MATRIX) {
      expect(row.common.length, row.area).toBeGreaterThan(0);
      expect(row.deltaTemplates.length, row.area).toBeGreaterThan(0);

      for (const common of row.common) {
        expect(allowedJudgements.has(common.judgement), common.id).toBe(true);
        expect(common.judgement, common.id).toBe("common");
        expect(common.id.startsWith(`${row.area}.`), common.id).toBe(true);
        expect(common.assertion, common.id).not.toEqual("");
        expect(ids.has(common.id), common.id).toBe(false);
        ids.add(common.id);
      }

      for (const delta of row.deltaTemplates) {
        expect(allowedJudgements.has(delta.judgement), delta.id).toBe(true);
        expect(delta.judgement, delta.id).not.toBe("common");
        expect(delta.id.startsWith(`${row.area}.`), delta.id).toBe(true);
        expect(delta.axes.length, delta.id).toBeGreaterThan(0);
        expect(delta.dbTypes.length, delta.id).toBeGreaterThan(0);
        expect(delta.assertion, delta.id).not.toEqual("");
        expect(delta.evidenceRule, delta.id).not.toEqual("");
        expect(ids.has(delta.id), delta.id).toBe(false);
        ids.add(delta.id);
      }
    }
  });

  it("requires every current DatabaseType to have a delta template in each contract area", () => {
    expect([...ADAPTER_CONTRACT_TEST_DATABASE_TYPES].sort()).toEqual(
      [...allDatabaseTypes].sort(),
    );

    for (const row of ADAPTER_CONTRACT_TEST_MATRIX) {
      const covered = new Set(
        row.deltaTemplates.flatMap((template) => template.dbTypes),
      );

      expect([...covered].sort(), row.area).toEqual(
        [...allDatabaseTypes].sort(),
      );
    }
  });

  it("keeps the matrix limited to #745 scaffolding areas, not child harness execution", () => {
    const areas = ADAPTER_CONTRACT_TEST_MATRIX.map((row) => row.area);

    expect(areas).toEqual([
      "query",
      "result",
      "catalog",
      "explain",
      "completion",
      "safety",
    ] satisfies AdapterContractTestArea[]);
    expect(areas).not.toContain("connection");
    expect(areas).not.toContain("edit");
    expect(areas).not.toContain("ddl");
  });
});
