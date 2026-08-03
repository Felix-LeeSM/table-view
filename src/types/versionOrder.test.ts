/** Issue #1821 — the shared triplet ordering. */
import { describe, expect, it } from "vitest";
import { isVersionAtLeast } from "./versionOrder";

const v = (major: number, minor: number, patch: number) => ({
  major,
  minor,
  patch,
});

describe("isVersionAtLeast", () => {
  it("is inclusive at the exact boundary", () => {
    expect(isVersionAtLeast(v(8, 0, 16), 8, 0, 16)).toBe(true);
  });

  it("stops at the first differing component — a higher major wins even with a lower minor", () => {
    expect(isVersionAtLeast(v(9, 0, 0), 8, 5, 99)).toBe(true);
    expect(isVersionAtLeast(v(7, 9, 99), 8, 0, 0)).toBe(false);
  });

  it("falls through to minor only when majors tie", () => {
    expect(isVersionAtLeast(v(8, 1, 0), 8, 0, 16)).toBe(true);
    expect(isVersionAtLeast(v(8, 0, 15), 8, 0, 16)).toBe(false);
  });

  it("falls through to patch only when majors and minors tie", () => {
    expect(isVersionAtLeast(v(10, 2, 1), 10, 2, 1)).toBe(true);
    expect(isVersionAtLeast(v(10, 2, 0), 10, 2, 1)).toBe(false);
    expect(isVersionAtLeast(v(10, 3, 0), 10, 2, 1)).toBe(true);
  });

  it("compares each component as a number, not as a joined string", () => {
    // `"10.0.0" >= "9.0.0"` is false as a string compare: "1" sorts under "9".
    expect(isVersionAtLeast(v(10, 0, 0), 9, 0, 0)).toBe(true);
    // ...and `"8.0.9" >= "8.0.10"` is true as one, for the same reason.
    expect(isVersionAtLeast(v(8, 0, 9), 8, 0, 10)).toBe(false);
  });

  it("never lets a large patch carry into the minor it lost on", () => {
    expect(isVersionAtLeast(v(8, 0, 150), 8, 1, 0)).toBe(false);
  });
});
