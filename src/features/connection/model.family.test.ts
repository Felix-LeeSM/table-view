import { describe, expect, it } from "vitest";
import {
  SUPPORTED_DATABASE_TYPES,
  isKvFamily,
  isSearchFamily,
  paradigmOf,
} from "./model";

// #1370 — characterize the family predicates against paradigmOf so the two
// converge for every DatabaseType (guards the `redis || valkey` /
// `elasticsearch || opensearch` disjunctions the helpers replaced).
describe("family predicates", () => {
  it("isKvFamily matches paradigm 'kv' (redis/valkey)", () => {
    for (const dbType of SUPPORTED_DATABASE_TYPES) {
      expect(isKvFamily(dbType)).toBe(paradigmOf(dbType) === "kv");
    }
    expect(isKvFamily("redis")).toBe(true);
    expect(isKvFamily("valkey")).toBe(true);
    expect(isKvFamily("postgresql")).toBe(false);
  });

  it("isSearchFamily matches paradigm 'search' (elasticsearch/opensearch)", () => {
    for (const dbType of SUPPORTED_DATABASE_TYPES) {
      expect(isSearchFamily(dbType)).toBe(paradigmOf(dbType) === "search");
    }
    expect(isSearchFamily("elasticsearch")).toBe(true);
    expect(isSearchFamily("opensearch")).toBe(true);
    expect(isSearchFamily("mongodb")).toBe(false);
  });
});
