import { describe, it, expect } from "vitest";
import {
  getConnectionColor,
  CONNECTION_COLOR_PALETTE,
} from "./connectionColor";
import type { ConnectionConfig } from "@/types/connection";

function makeConn(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "conn-1",
    name: "Test",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "db",
    group_id: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

describe("getConnectionColor", () => {
  it("returns the user-picked color when set", () => {
    expect(getConnectionColor(makeConn({ color: "#123456" }))).toBe("#123456");
  });

  it("derives a deterministic palette color from id when color is null", () => {
    const a = getConnectionColor(makeConn({ id: "abc", color: null }));
    const b = getConnectionColor(makeConn({ id: "abc", color: null }));
    expect(a).toBe(b);
    expect(CONNECTION_COLOR_PALETTE).toContain(a);
  });

  it("maps different ids onto the palette (at least two ids give different colors)", () => {
    // Not a strict guarantee, but the palette has 10 entries — sampling 20 ids
    // should produce at least two distinct colors in practice.
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(getConnectionColor(makeConn({ id: `id-${i}`, color: null })));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("always returns a value from the palette for empty color", () => {
    const color = getConnectionColor(makeConn({ id: "x", color: null }));
    expect(CONNECTION_COLOR_PALETTE).toContain(color);
  });
});
