import { describe, expect, it } from "vitest";
import {
  DATABASE_TYPE_LABELS,
  paradigmOf,
  type DatabaseType,
  type Paradigm,
} from "./connection";
import { ADAPTER_CONFORMANCE_MATRIX } from "./adapterConformance";
import {
  ADAPTER_CONTRACT_TEST_MATRIX,
  type AdapterContractDeltaAxis,
} from "./adapterContractTestMatrix";
import {
  DATA_SOURCE_PROFILES,
  getConnectionSupportedDatabaseTypes,
  type QueryLanguageId,
  type SafetyPolicyId,
} from "./dataSource";

const ALL_DATABASE_TYPES = Object.keys(DATABASE_TYPE_LABELS) as DatabaseType[];

const SAFETY_POLICY_BY_PARADIGM = Object.freeze({
  rdb: "rdb-default",
  document: "document-default",
  kv: "kv-default",
  search: "search-default",
} as const satisfies Readonly<Record<Paradigm, SafetyPolicyId>>);

const FUTURE_LANGUAGE_PLACEHOLDERS = Object.freeze([
  "cql",
  "partiql",
  "cypher",
  "gql",
  "gremlin",
  "vector-query",
  "stream-command",
] as const satisfies readonly QueryLanguageId[]);

describe("adapter safety/capability contract", () => {
  it("maps every active profile to the safety policy for its paradigm", () => {
    for (const dbType of ALL_DATABASE_TYPES) {
      const profile = DATA_SOURCE_PROFILES[dbType];
      const conformance = ADAPTER_CONFORMANCE_MATRIX[dbType];

      expect(profile.paradigm, dbType).toBe(paradigmOf(dbType));
      expect(profile.safetyPolicy, dbType).toBe(
        SAFETY_POLICY_BY_PARADIGM[profile.paradigm],
      );
      expect(conformance.areas.safety, dbType).toEqual({
        area: "safety",
        level: "declared",
        checks: ["safety.policy"],
        unsupported: [],
        deferred: [],
      });
    }
  });

  it("keeps profile identity separate from runtime connection support", () => {
    const expectedRuntime = ALL_DATABASE_TYPES.filter(
      (dbType) => DATA_SOURCE_PROFILES[dbType].capabilities.connection.test,
    );

    expect(getConnectionSupportedDatabaseTypes()).toEqual(expectedRuntime);

    for (const dbType of ALL_DATABASE_TYPES) {
      const hasRuntimeConnection =
        DATA_SOURCE_PROFILES[dbType].capabilities.connection.test;

      expect(ADAPTER_CONFORMANCE_MATRIX[dbType].level, dbType).toBe(
        hasRuntimeConnection ? "runtime" : "declared",
      );
    }
  });

  it("keeps future language placeholders out of active runtime profiles", () => {
    const activeLanguages = new Set<QueryLanguageId>(
      ALL_DATABASE_TYPES.flatMap(
        (dbType) => DATA_SOURCE_PROFILES[dbType].languages,
      ),
    );

    expect(
      FUTURE_LANGUAGE_PLACEHOLDERS.filter((language) =>
        activeLanguages.has(language),
      ),
    ).toEqual([]);
  });

  it("pins #768 safety matrix coverage to unsupported deltas", () => {
    const safetyRow = ADAPTER_CONTRACT_TEST_MATRIX.find(
      (row) => row.area === "safety",
    );

    expect(safetyRow?.childIssue).toBe(768);
    expect(safetyRow?.common.map((item) => item.id)).toEqual([
      "safety.policy-envelope",
      "safety.planned-identity",
    ]);
    expect(safetyRow?.deltaTemplates.map((item) => item.judgement)).toEqual([
      "unsupported-delta",
      "unsupported-delta",
    ]);
    expect(
      new Set(
        safetyRow?.deltaTemplates.flatMap((template) => template.dbTypes),
      ),
    ).toEqual(new Set(ALL_DATABASE_TYPES));

    const coveredAxes = new Set<AdapterContractDeltaAxis>(
      safetyRow?.deltaTemplates.flatMap((template) => template.axes),
    );
    expect(coveredAxes).toEqual(
      new Set(["dbms", "dialect", "capability", "paradigm", "evidence"]),
    );
  });
});
