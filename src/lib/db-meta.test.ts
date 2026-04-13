import { describe, it, expect } from "vitest";
import { DB_TYPE_META } from "./db-meta";
import type { DatabaseType } from "../types/connection";

describe("DB_TYPE_META", () => {
  const expectedTypes: DatabaseType[] = [
    "postgresql",
    "mysql",
    "sqlite",
    "mongodb",
    "redis",
  ];

  it("contains metadata for every DatabaseType", () => {
    for (const dbType of expectedTypes) {
      expect(DB_TYPE_META).toHaveProperty(dbType);
    }
  });

  it("has no extra keys beyond known DatabaseType values", () => {
    const keys = Object.keys(DB_TYPE_META);
    expect(keys).toHaveLength(expectedTypes.length);
    for (const key of keys) {
      expect(expectedTypes).toContain(key);
    }
  });

  it("has label, short, and color for every entry", () => {
    for (const dbType of expectedTypes) {
      const meta = DB_TYPE_META[dbType];
      expect(meta).toBeDefined();
      expect(typeof meta.label).toBe("string");
      expect(meta.label.length).toBeGreaterThan(0);
      expect(typeof meta.short).toBe("string");
      expect(meta.short.length).toBeGreaterThan(0);
      expect(typeof meta.color).toBe("string");
      expect(meta.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has unique short abbreviations", () => {
    const shorts = expectedTypes.map((t) => DB_TYPE_META[t].short);
    const unique = new Set(shorts);
    expect(unique.size).toBe(shorts.length);
  });

  it("has unique colors", () => {
    const colors = expectedTypes.map((t) => DB_TYPE_META[t].color);
    const unique = new Set(colors);
    expect(unique.size).toBe(colors.length);
  });
});
