import { describe, expect, it } from "vitest";

import {
  describePostgresPlanNode,
  describePostgresPlanTiming,
  extractPostgresExplainPlan,
  getPostgresPlanChildren,
} from "./postgresPlan";

describe("postgresPlan", () => {
  it("extracts the top-level PostgreSQL JSON explain plan", () => {
    const plan = extractPostgresExplainPlan([
      {
        Plan: {
          "Node Type": "Seq Scan",
          "Relation Name": "users",
          "Total Cost": 12.5,
        },
        "Planning Time": 0.12,
        "Execution Time": 1.75,
      },
    ]);

    expect(plan?.root["Node Type"]).toBe("Seq Scan");
    expect(describePostgresPlanTiming(plan ?? { root: {} })).toEqual([
      { label: "Planning Time", value: "0.12 ms" },
      { label: "Execution Time", value: "1.75 ms" },
    ]);
  });

  it("returns null for unknown explain payloads", () => {
    expect(extractPostgresExplainPlan({ ok: 1 })).toBeNull();
    expect(extractPostgresExplainPlan([{ QueryPlan: {} }])).toBeNull();
  });

  it("describes node labels, metrics, row removals, and conditions", () => {
    const description = describePostgresPlanNode({
      "Node Type": "Index Scan",
      Schema: "public",
      "Relation Name": "users",
      "Index Name": "users_pkey",
      Alias: "u",
      "Startup Cost": 0.14,
      "Total Cost": 8.16,
      "Plan Rows": 1,
      "Actual Startup Time": 0.02,
      "Actual Total Time": 0.03,
      "Rows Removed by Filter": 2,
      "Index Cond": "(id = 1)",
    });

    expect(description.title).toBe("Index Scan");
    expect(description.subtitle).toBe(
      "on public.users / using users_pkey / alias u",
    );
    expect(description.metrics).toContainEqual({
      label: "Cost",
      value: "0.14..8.16",
    });
    expect(description.metrics).toContainEqual({
      label: "Actual Time",
      value: "0.02..0.03 ms",
    });
    expect(description.metrics).toContainEqual({
      label: "Rows Removed by Filter",
      value: "2",
    });
    expect(description.metrics).toContainEqual({
      label: "Index Cond",
      value: "(id = 1)",
    });
  });

  it("keeps nested child plans as typed plan nodes", () => {
    const children = getPostgresPlanChildren({
      "Node Type": "Nested Loop",
      Plans: [
        { "Node Type": "Index Scan" },
        null,
        "bad",
        { "Node Type": "Seq Scan" },
      ],
    });

    expect(children.map((child) => child["Node Type"])).toEqual([
      "Index Scan",
      "Seq Scan",
    ]);
  });
});
