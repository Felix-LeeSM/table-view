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
});
