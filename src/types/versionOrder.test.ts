/**
 * Issue #1821 — the shared triplet ordering that replaced three hand-copied
 * expressions (`meetsMongoRuntimeRequirement`, the MySQL/MariaDB catalog gate
 * in `./dataSourceVersionCapabilities`, and the MariaDB `RETURNING` gate in
 * `@features/completion/sql/sqlCompletionRequest`).
 *
 * Two families of case here. The boundaries catch a rewrite that forgot to
 * stop at the first differing component — a lower `minor` under a higher
 * `major` is the sharpest of those. The numeric cases catch two rewrites that
 * pass every boundary case anyway: a string compare of the joined triplet, and
 * a `major·R² + minor·R + patch` fold. The fold half is bounded — the last
 * case separates a fold only for R ≤ 150, so a radix-1000 fold still passes
 * every `expect` in this file.
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

  // PR #2105 review, non-blocking 1: every case above stays green under a
  // string compare of the joined triplet — no case above is decided by a
  // character that string order reads differently from numeric order. The two
  // `expect`s below are where that rewrite answers wrong. They say nothing
  // about a fold, which no radix makes fail here; the next case is for that.
  it("compares each component as a number, not as a joined string", () => {
    // `"10.0.0" >= "9.0.0"` is false as a string compare: "1" sorts under "9".
    expect(isVersionAtLeast(v(10, 0, 0), 9, 0, 0)).toBe(true);
    // ...and `"8.0.9" >= "8.0.10"` is true as one, for the same reason.
    expect(isVersionAtLeast(v(8, 0, 9), 8, 0, 10)).toBe(false);
  });

  it("never lets a large patch carry into the minor it lost on", () => {
    // A `major * 10000 + minor * 100 + patch` fold reads 8.0.150 as 80150 and
    // 8.1.0 as 80100, opening a gate the server does not meet. Component-wise,
    // minor 0 loses to minor 1 and the patch never gets a vote. The ceiling:
    // this separates folds only up to radix 150. At radix 1000 the patch no
    // longer reaches the minor's weight, and that fold passes this file.
    expect(isVersionAtLeast(v(8, 0, 150), 8, 1, 0)).toBe(false);
  });
});
