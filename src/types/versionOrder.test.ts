/**
 * Issue #1821 — the shared triplet ordering that replaced three hand-copied
 * expressions (`meetsMongoRuntimeRequirement`, the MySQL/MariaDB catalog gate
 * in `./dataSourceVersionCapabilities`, and the MariaDB `RETURNING` gate in
 * `@features/completion/sql/sqlCompletionRequest`).
 *
 * The cases below are the boundaries where a lexicographic comparison and a
 * naive component-wise one disagree — a lower `minor` under a higher `major`
 * is the one that catches a rewrite that forgot to stop at the first
 * differing component.
 */
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
});
