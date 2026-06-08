// Sprint 1 — Fixture generator integrity guard.
//
// 작성 일자: 2026-05-09. handoff 의 4 개 핵심 invariant 를 회귀로부터 보호:
//   1. PK / unique 컬럼은 1000 행 스케일에서도 충돌 없이 생성된다
//      (4 locale faker 가 distinct 한 seed offset 으로 시드된 결과 — 동일
//      seed 로 시드되면 첫 uuid 호출이 모든 locale 에서 비트 동일).
//   2. ref(FK) 컬럼은 항상 부모 entity 의 *기존* row id 만 참조한다
//      (FK ordering bug 회귀 가드).
//   3. nullable=false 컬럼은 절대 null 을 받지 않는다 (edge category 가
//      nullable PK 으로 새지 않는지).
//   4. max_length 가 명시된 컬럼은 truncation 후에도 한도 내에 있다
//      (very_long edge 가 한도 초과 abort 를 일으키지 않도록 truncate 적용).
//
// development / e2e profile 둘 다 검증할 필요는 없음 — 동일 generator
// 코드 경로이므로 e2e 의 200-row 스케일로 빠르게 실행.

import { describe, it, expect } from "vitest";
import { flattenConnections, generateAll } from "./generator.js";
import { loadSpec } from "./spec.js";

const spec = loadSpec("e2e");
const rows = generateAll(spec);

describe("generator — PK uniqueness across locales", () => {
  it("produces unique customer ids at e2e scale (200 rows)", () => {
    const ids = rows.customers!.map((r) => r.id as string);
    expect(ids.length).toBe(200);
    expect(new Set(ids).size).toBe(200);
  });

  it("produces unique product ids", () => {
    const ids = rows.products!.map((r) => r.id as string);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("generator — UNIQUE column guard", () => {
  it("never duplicates a customer email even when edge values would collide", () => {
    const emails = rows.customers!.map((r) => r.email as string);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("never duplicates a product sku", () => {
    const skus = rows.products!.map((r) => r.sku as string);
    expect(new Set(skus).size).toBe(skus.length);
  });
});

describe("generator — FK referential integrity", () => {
  it("every order.customer_id points at an existing customer", () => {
    const customerIds = new Set(rows.customers!.map((r) => r.id));
    for (const order of rows.orders!) {
      expect(customerIds.has(order.customer_id)).toBe(true);
    }
  });

  it("every order_items.order_id and product_id resolves to a parent", () => {
    const orderIds = new Set(rows.orders!.map((r) => r.id));
    const productIds = new Set(rows.products!.map((r) => r.id));
    for (const item of rows.order_items!) {
      expect(orderIds.has(item.order_id)).toBe(true);
      expect(productIds.has(item.product_id)).toBe(true);
    }
  });

  it("nullable ref (support_tickets.customer_id) resolves OR is null", () => {
    const customerIds = new Set(rows.customers!.map((r) => r.id));
    for (const t of rows.support_tickets!) {
      expect(t.customer_id === null || customerIds.has(t.customer_id)).toBe(
        true,
      );
    }
  });
});

describe("generator — NOT NULL + max_length integrity", () => {
  it("non-nullable columns never produce null", () => {
    for (const c of rows.customers!) {
      expect(c.id).not.toBeNull();
      expect(c.email).not.toBeNull();
      expect(c.full_name).not.toBeNull();
      // phone is nullable — skip
      expect(c.created_at).not.toBeNull();
    }
  });

  it("max_length columns are within bounds (incl. truncated edge values)", () => {
    for (const c of rows.customers!) {
      const fn = c.full_name as string;
      expect(fn.length).toBeLessThanOrEqual(200);
    }
    for (const t of rows.support_tickets!) {
      expect((t.subject as string).length).toBeLessThanOrEqual(200);
      const body = t.body as string | null;
      if (body !== null) expect(body.length).toBeLessThanOrEqual(5000);
    }
  });
});

describe("generator — determinism", () => {
  // 결정성은 seed 기반 RNG 가 결정짓는 *컬럼* 만 검증. timestamp 는
  // `parseRangeDays` 가 `Date.now()` 를 anchor 로 쓰므로 동일 seed 라도
  // 두 호출의 timestamp 가 다르다 (의도적 — fixture 시드 시점 기준 상대
  // 날짜 표현 위해). 따라서 결정성 검증은 timestamp 외 컬럼으로 한정.
  it("same seed produces identical id / email / full_name across two runs", () => {
    const a = generateAll(spec);
    const b = generateAll(spec);
    const pick = (r: Record<string, unknown>) => ({
      id: r.id,
      email: r.email,
      full_name: r.full_name,
      phone: r.phone,
    });
    expect(pick(a.customers![0]!)).toEqual(pick(b.customers![0]!));
    expect(a.products![0]!.sku).toEqual(b.products![0]!.sku);
  });
});

describe("generator — connection flattening", () => {
  it("includes active MSSQL fixture identities while excluding planned Oracle", () => {
    const flattened = flattenConnections(spec.profileSpec);
    expect(flattened.map((c) => c.target)).toContain("mssql");
    expect(flattened.map((c) => c.target)).not.toContain("oracle");
  });
});
