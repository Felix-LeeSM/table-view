import { describe, it, expect } from "vitest";
import {
  rankQuickOpen,
  scoreItem,
  type RankableFields,
} from "./quickOpenRanking";

// Fields are pre-lowercased by contract (the component lowercases once when it
// builds the inventory), so tests pass lowercase directly.
function item(name: string, schema = "public", conn = "prod"): RankableFields {
  return { nameLower: name, schemaLower: schema, connLower: conn };
}

describe("scoreItem — deterministic tier ladder", () => {
  const q = "user";

  it("exact > prefix > word-boundary > substring > fuzzy", () => {
    const exact = scoreItem(item("user"), q); // === query
    const prefix = scoreItem(item("users"), q); // startsWith
    const boundary = scoreItem(item("app_user"), q); // after "_"
    const substring = scoreItem(item("abuser"), q); // mid-word
    const fuzzy = scoreItem(item("uxsxexr"), q); // subsequence only

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });

  it("ranks name matches above schema and connection matches", () => {
    // name prefix must beat schema exact and connection exact
    const nameHit = scoreItem(
      { nameLower: "audit_log", schemaLower: "public", connLower: "prod" },
      "audit",
    );
    const schemaHit = scoreItem(
      { nameLower: "users", schemaLower: "audit", connLower: "prod" },
      "audit",
    );
    const connHit = scoreItem(
      { nameLower: "users", schemaLower: "public", connLower: "audit_db" },
      "audit",
    );
    expect(nameHit).toBeGreaterThan(schemaHit);
    expect(schemaHit).toBeGreaterThan(connHit);
  });
});

describe("scoreItem — fuzzy subsequence (last resort)", () => {
  it("matches usrord against users_orders", () => {
    expect(scoreItem(item("users_orders"), "usrord")).toBeGreaterThan(0);
  });

  it("does not match when the subsequence is broken", () => {
    // "usrz" — no trailing z after the subsequence in users_orders
    expect(scoreItem(item("users_orders"), "usrzz")).toBe(0);
  });

  it("keeps a real substring above a fuzzy-only candidate", () => {
    const ranked = rankQuickOpen(
      [item("axb"), item("cadab")], // "cadab" has substring "ab"; "axb" only fuzzy
      "ab",
    );
    expect(ranked.map((i) => i.nameLower)).toEqual(["cadab", "axb"]);
  });

  it("accepts an optional signals argument (reserved for #1218)", () => {
    expect(scoreItem(item("users"), "users", {})).toBeGreaterThan(0);
  });
});

describe("rankQuickOpen — schema-qualified `.` syntax", () => {
  const items: RankableFields[] = [
    { nameLower: "orders", schemaLower: "sales", connLower: "prod" },
    { nameLower: "orders", schemaLower: "public", connLower: "prod" },
    { nameLower: "order_items", schemaLower: "sales", connLower: "prod" },
  ];

  it("scopes the prefix to schema and the suffix to name", () => {
    const ranked = rankQuickOpen(items, "sales.ord");
    // only sales-schema rows survive
    expect(ranked.every((i) => i.schemaLower === "sales")).toBe(true);
    // both match name~ord at prefix tier → alphabetical tiebreak
    expect(ranked.map((i) => i.nameLower)).toEqual(["order_items", "orders"]);
  });

  it("mixes a `.` token with a plain AND token", () => {
    const mixed: RankableFields[] = [
      { nameLower: "order_items", schemaLower: "sales", connLower: "prod" },
      { nameLower: "orders", schemaLower: "sales", connLower: "prod" },
    ];
    // "sales.ord" gates schema+name; "items" must also match → only order_items
    const ranked = rankQuickOpen(mixed, "sales.ord items");
    expect(ranked.map((i) => i.nameLower)).toEqual(["order_items"]);
  });
});

describe("scoreItem — treeShape degradation of the `.` token", () => {
  const withSchema: RankableFields = {
    nameLower: "orders",
    schemaLower: "sales",
    connLower: "prod",
    hasSchema: true,
  };
  const flat: RankableFields = {
    nameLower: "orders",
    schemaLower: "main",
    connLower: "prod",
    hasSchema: false,
  };

  it("scopes `.` to the schema field when the shape has a schema layer", () => {
    // with-schema (PG) and no-schema (MySQL: schemaLower holds the database)
    // both share this path — prefix scopes schema, suffix scopes name.
    expect(scoreItem(withSchema, "sales.ord")).toBeGreaterThan(0);
    expect(scoreItem(withSchema, "hr.ord")).toBe(0); // wrong schema prefix
  });

  it("degrades `.` to a plain full-string match on a flat shape", () => {
    // A flat item has no schema layer, so `main.ord` is NOT schema-scoped —
    // it is matched literally (dot and all), which no field contains, so the
    // result is empty rather than an error.
    expect(scoreItem(flat, "main.ord")).toBe(0);
    // A dotless query still matches by name on the same flat item.
    expect(scoreItem(flat, "ord")).toBeGreaterThan(0);
  });

  it("shares one tier ladder across shapes for plain tokens", () => {
    // Same name → same plain-token score regardless of shape.
    expect(scoreItem(flat, "orders")).toBe(scoreItem(withSchema, "orders"));
  });
});

describe("rankQuickOpen — ordering & tiebreak", () => {
  const items: RankableFields[] = [
    { nameLower: "zebra", schemaLower: "public", connLower: "prod" },
    { nameLower: "apple", schemaLower: "public", connLower: "prod" },
    { nameLower: "mango", schemaLower: "public", connLower: "prod" },
  ];

  it("breaks equal scores alphabetically by name", () => {
    // all three match schema "public" exactly → same score
    const ranked = rankQuickOpen(items, "public");
    expect(ranked.map((i) => i.nameLower)).toEqual(["apple", "mango", "zebra"]);
  });

  it("preserves inventory order for an empty query", () => {
    expect(rankQuickOpen(items, "").map((i) => i.nameLower)).toEqual([
      "zebra",
      "apple",
      "mango",
    ]);
    expect(rankQuickOpen(items, "   ")).toHaveLength(3);
  });

  it("drops non-matches", () => {
    expect(rankQuickOpen(items, "nonexistent")).toHaveLength(0);
  });

  it("breaks equal scores by schema then connection", () => {
    const bySchema = rankQuickOpen(
      [
        { nameLower: "orders", schemaLower: "b", connLower: "prod" },
        { nameLower: "orders", schemaLower: "a", connLower: "prod" },
      ],
      "orders",
    );
    expect(bySchema.map((i) => i.schemaLower)).toEqual(["a", "b"]);

    const byConn = rankQuickOpen(
      [
        { nameLower: "orders", schemaLower: "a", connLower: "z" },
        { nameLower: "orders", schemaLower: "a", connLower: "a" },
      ],
      "orders",
    );
    expect(byConn.map((i) => i.connLower)).toEqual(["a", "z"]);
  });
});

describe("scoreItem — `.` token edge cases", () => {
  const item: RankableFields = {
    nameLower: "orders",
    schemaLower: "sales",
    connLower: "prod",
  };

  it("treats an empty name part (`sales.`) as match-all within the schema", () => {
    expect(scoreItem(item, "sales.")).toBeGreaterThan(0);
    expect(scoreItem({ ...item, schemaLower: "hr" }, "sales.")).toBe(0);
  });

  it("treats an empty schema part (`.orders`) as schema-unconstrained", () => {
    expect(scoreItem(item, ".orders")).toBeGreaterThan(0);
    expect(scoreItem({ ...item, schemaLower: "anything" }, ".orders")).toBe(
      scoreItem(item, ".orders"),
    );
  });

  it("splits a multi-dot token at the first dot", () => {
    // "a.b.c" → schema "a", name "b.c"
    expect(
      scoreItem(
        { nameLower: "b.c", schemaLower: "a", connLower: "x" },
        "a.b.c",
      ),
    ).toBeGreaterThan(0);
    expect(
      scoreItem(
        { nameLower: "c", schemaLower: "a.b", connLower: "x" },
        "a.b.c",
      ),
    ).toBe(0); // name "c" != "b.c"
  });
});

describe("scoreItem — Unicode / non-ASCII input", () => {
  const item: RankableFields = {
    nameLower: "사용자_주문",
    schemaLower: "공개",
    connLower: "운영",
  };

  it("matches Hangul prefixes, word boundaries, and fuzzy subsequences", () => {
    const prefix = scoreItem(item, "사용자"); // startsWith
    const boundary = scoreItem(item, "주문"); // after "_"
    const fuzzy = scoreItem(item, "사주"); // subsequence 사…주
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });
});
