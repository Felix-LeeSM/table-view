import { describe, expect, it } from "vitest";
import {
  collectSmokeScriptMatrix,
  collectWorkflowMatrix,
  loadSmokeRoutingDecisions,
  validateSmokeRoutingDecisions,
} from "../../scripts/e2e-smoke-routing-decisions";

describe("smoke-routing-decisions.json", () => {
  it("classifies every promoted fixture with the issue #753 tier contract", () => {
    const decisions = loadSmokeRoutingDecisions();
    const ids = new Set<string>();

    expect(decisions.$schema).toBe("smoke-routing-decisions@1");
    expect(decisions.issue).toBe(753);
    expect(decisions.allowedTiers).toEqual([
      "unit-only",
      "integration-backed",
      "dormant E2E",
      "blocking E2E",
    ]);

    for (const row of decisions.rows) {
      expect(ids.has(row.id), row.id).toBe(false);
      ids.add(row.id);
      expect(row.fixture, row.id).not.toHaveLength(0);
      expect(row.runtimeCost, row.id).not.toHaveLength(0);
      expect(row.flakeRisk, row.id).not.toHaveLength(0);
      expect(row.cacheImpact, row.id).not.toHaveLength(0);
      expect(row.failureArtifacts, row.id).not.toHaveLength(0);
      expect(row.supportClaimImpact, row.id).not.toHaveLength(0);
      expect(row.action, row.id).not.toHaveLength(0);
    }

    expect(decisions.rows.map((row) => row.tier)).toEqual(
      expect.arrayContaining([
        "unit-only",
        "integration-backed",
        "dormant E2E",
        "blocking E2E",
      ]),
    );
  });

  it("keeps fixture promotion decisions aligned with script and workflow smoke routes", () => {
    const result = validateSmokeRoutingDecisions();

    expect(result.errors).toEqual([]);
    expect(result.blockingDecisionMatrix).toContainEqual({
      specKey: "duckdb-file-analytics",
      spec: "e2e/smoke/duckdb-file-analytics.spec.ts",
    });
    expect(result.blockingDecisionMatrix).toContainEqual({
      specKey: "erd-dense",
      spec: "e2e/smoke/erd-dense.spec.ts",
    });
    expect(result.blockingDecisionMatrix).toContainEqual({
      specKey: "mssql",
      spec: "e2e/smoke/mssql.spec.ts",
    });
    expect(result.blockingDecisionMatrix).toContainEqual({
      specKey: "oracle",
      spec: "e2e/smoke/oracle.spec.ts",
    });
    expect(result.blockingDecisionMatrix).toContainEqual({
      specKey: "redis-key-detail-panel",
      spec: "e2e/smoke/redis-key-detail-panel.spec.ts",
    });
    expect(result.blockingDecisionMatrix).toEqual(collectSmokeScriptMatrix());
    expect(result.blockingDecisionMatrix).toEqual(collectWorkflowMatrix());
    expect(result.blockingDecisionMatrix).toHaveLength(21);
  });
});
