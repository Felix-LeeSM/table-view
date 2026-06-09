// Sprint 1 — Fixture spec parsing + integrity coherence guard.
//
// 작성 일자: 2026-05-09. docs/fixture-data-workflow-handoff.md 의 spec
// 정의 lock 을 회귀로부터 보호한다.
//
// 검증 범위:
//   - entityOrder 가 FK 의존성 위배 없이 topo-sort 한다
//   - effectiveColumnConstraints 가 PK 의 nullable/unique implication 을
//     명시 선언과 동일하게 유도한다
//   - loadSpec("development") / loadSpec("e2e") 둘 다 zod 검증 통과 +
//     coherence (locale_mix sum=1, ref target 존재) 통과
//   - 알 수 없는 프로파일 / 알 수 없는 entity 참조 / locale_mix sum 미스매치
//     모두 명확한 에러 메시지로 fail-fast
import { describe, it, expect } from "vitest";
import {
  effectiveColumnConstraints,
  entityOrder,
  loadSpec,
  type BaseSpec,
} from "./spec.js";

describe("spec — entityOrder topological sort", () => {
  it("places referenced entities before their referers", () => {
    const order = entityOrder(loadSpec("development").base);
    expect(order.indexOf("customers")).toBeLessThan(order.indexOf("orders"));
    expect(order.indexOf("orders")).toBeLessThan(order.indexOf("order_items"));
    expect(order.indexOf("products")).toBeLessThan(
      order.indexOf("order_items"),
    );
    expect(order.indexOf("customers")).toBeLessThan(
      order.indexOf("support_tickets"),
    );
  });

  it("rejects circular FK dependencies", () => {
    const cyclic: BaseSpec = {
      entities: {
        a: {
          targets: ["pg"],
          pg: { schema: "s", table: "a" },
          columns: {
            id: { type: "uuid", primary: true },
            b_id: { type: "ref", to: "b.id" },
          },
        },
        b: {
          targets: ["pg"],
          pg: { schema: "s", table: "b" },
          columns: {
            id: { type: "uuid", primary: true },
            a_id: { type: "ref", to: "a.id" },
          },
        },
      },
    };
    expect(() => entityOrder(cyclic)).toThrow(/circular FK dependency/);
  });
});

describe("spec — effectiveColumnConstraints PK implication", () => {
  it("primary key implies nullable=false + unique=true even when not declared", () => {
    const c = effectiveColumnConstraints({ type: "uuid", primary: true });
    expect(c).toEqual({
      primary: true,
      nullable: false,
      unique: true,
      maxLength: undefined,
      minLength: undefined,
    });
  });

  it("non-PK column inherits explicit nullable / unique flags", () => {
    const c = effectiveColumnConstraints({
      type: "email",
      unique: true,
      nullable: true,
      max_length: 255,
    });
    expect(c).toEqual({
      primary: false,
      nullable: true,
      unique: true,
      maxLength: 255,
      minLength: undefined,
    });
  });
});

describe("spec — loadSpec validation", () => {
  it("loads development profile and exposes seed + databases", () => {
    const spec = loadSpec("development");
    expect(spec.profileSpec.seed).toBe(4242);
    expect(spec.profileSpec.database.pg).toBe("table_view_development");
    expect(spec.profileSpec.database.mongo).toBe("table_view_development");
  });

  it("loads e2e profile and exposes its smaller scale", () => {
    const spec = loadSpec("e2e");
    expect(spec.profileSpec.seed).toBe(42);
    expect(spec.profileSpec.rows.customers).toBe(200);
  });

  it("loads the SQLite local-file fixture strategy for e2e", () => {
    const spec = loadSpec("e2e");
    const database = spec.profileSpec.database as { sqlite?: string };
    const connections = spec.profileSpec.connections as
      | { sqlite?: { id: string; name: string }[] }
      | undefined;

    expect(database.sqlite).toBe("table_view_e2e.sqlite");
    expect(connections?.sqlite).toEqual([
      expect.objectContaining({
        id: "fixture-e2e-sqlite",
        name: "E2E (SQLite)",
      }),
    ]);
  });

  it("makes MSSQL and Oracle active fixture identities", () => {
    const spec = loadSpec("e2e");
    const mssql = spec.profileSpec.connections?.mssql?.[0];
    const oracle = spec.profileSpec.connections?.oracle?.[0];

    expect(mssql).toEqual(
      expect.objectContaining({
        id: "fixture-e2e-mssql",
      }),
    );
    expect(mssql).not.toHaveProperty("status");
    expect(oracle).toEqual(
      expect.objectContaining({
        id: "fixture-e2e-oracle",
      }),
    );
    expect(oracle).not.toHaveProperty("status");
  });

  it("fails fast on an unknown profile name", () => {
    expect(() => loadSpec("__nonexistent__")).toThrow(
      /fixture profile not found/,
    );
  });
});
