// Purpose: guard the Redis type showcase (redis-showcase.ts) so it keeps
// covering every shape the app's KV inspector renders and its edge encodings —
// a static/offline test over the pure buildShowcase() spec + redisScore()
// transform, mirroring pg-showcase.test.ts. The live apply is exercised by
// `pnpm fixtures:rebuild development --target redis`. (2026-07-18)
import { describe, it, expect } from "vitest";
import { buildShowcase, redisScore, KINDS } from "./redis-showcase.js";

describe("redis showcase — type coverage", () => {
  // Reason: the app dispatches on Redis TYPE and renders exactly these shapes
  // (src-tauri/src/db/redis). If a kind is dropped from the gallery, that
  // renderer path silently loses its only fixture — this is the parity guard.
  it("includes at least one key for every renderable kind", () => {
    const present = new Set(buildShowcase().map((e) => e.kind));
    for (const kind of KINDS) {
      expect(present, `showcase missing kind: ${kind}`).toContain(kind);
    }
  });

  // Reason: each key must land under `showcase:` so the gallery groups in the
  // key tree and never collides with entity hashes (customer:*, product:* …).
  it("namespaces every key under showcase:", () => {
    for (const e of buildShowcase()) {
      expect(e.key, `un-namespaced key: ${e.key}`).toMatch(/^showcase:/);
    }
  });
});

describe("redis showcase — render-path fixtures", () => {
  const bySuffix = (suffix: string) =>
    buildShowcase().find((e) => e.key.endsWith(suffix));

  // Reason: the smart string renderer (commit 0e8188fd) shows a JSON tree only
  // when a string parses to an object/array. If this value regresses to a
  // scalar, the tree demo silently dies — assert it stays object-shaped.
  it("string:config is a JSON-object string (drives the DocumentTree path)", () => {
    const e = bySuffix("string:config");
    expect(e?.kind).toBe("string");
    const parsed = JSON.parse((e as { value: string }).value);
    expect(Array.isArray(parsed)).toBe(false);
    expect(typeof parsed).toBe("object");
  });

  // Reason: the bare-scalar string must NOT parse to an object, or it would
  // render as a tree instead of the raw <pre> it's meant to demonstrate.
  it("string:counter stays a bare scalar (raw <pre> path)", () => {
    const e = bySuffix("string:counter");
    expect(typeof JSON.parse((e as { value: string }).value)).not.toBe(
      "object",
    );
  });

  // Reason: the binary-string fixture must be non-utf8 so the app takes the hex
  // fallback rather than the utf8 text path.
  it("string:binary holds non-utf8 bytes (hex-view path)", () => {
    const e = bySuffix("string:binary");
    const buf = Buffer.from((e as { hex: string }).hex, "hex");
    // Invalid utf8 → re-encoding the decoded string can't reproduce the bytes,
    // which is exactly what makes the app fall back to the hex view.
    expect(Buffer.from(buf.toString("utf8"), "utf8").equals(buf)).toBe(false);
  });

  // Reason: at least one key must carry a TTL so the TTL badge's "expires"
  // state has a fixture (persistent keys already cover the other state).
  it("ships a key with a TTL", () => {
    expect(buildShowcase().some((e) => typeof e.ttl === "number")).toBe(true);
  });

  // Reason: the gallery must actually exercise unicode/emoji so the KV tables
  // are seen with multibyte content, not just ASCII.
  it("carries unicode/emoji content somewhere", () => {
    const blob = JSON.stringify(buildShowcase());
    expect(/[\u{1F300}-\u{1FAFF}]/u.test(blob), "no emoji in showcase").toBe(
      true,
    );
  });
});

describe("redis showcase — zset score encoding", () => {
  // Reason: Redis ZADD wants the literal tokens `+inf`/`-inf`; JS `Infinity`
  // serializes to "Infinity" which Redis rejects. This transform is the one
  // bit of non-trivial apply logic — assert it maps correctly.
  it("maps Infinity/-Infinity to +inf/-inf and passes finite scores through", () => {
    expect(redisScore(Infinity)).toBe("+inf");
    expect(redisScore(-Infinity)).toBe("-inf");
    expect(redisScore(0)).toBe(0);
    expect(redisScore(-42)).toBe(-42);
    expect(redisScore(1499.5)).toBe(1499.5);
  });

  // Reason: the leaderboard is the fixture that proves the app renders infinite
  // scores — it must keep boundary members, else the encoding above is untested
  // end-to-end.
  it("leaderboard includes +inf and -inf members", () => {
    const zset = buildShowcase().find((e) =>
      e.key.endsWith("zset:leaderboard"),
    );
    const scores = (zset as { members: [string, number][] }).members.map(
      ([, s]) => s,
    );
    expect(scores).toContain(Infinity);
    expect(scores).toContain(-Infinity);
  });
});

describe("redis showcase — bulk knob", () => {
  // Reason: paging (SSCAN/HSCAN cursor, LRANGE/ZRANGE limit) is only visible
  // when collections exceed a page. The bulk arg must grow the collections;
  // bulk=0 must still yield the curated keys (env override, like SHOWCASE_ROWS).
  it("grows paging-sensitive collections by the bulk arg", () => {
    const small = buildShowcase(0).find((e) => e.key.endsWith("set:tags")) as {
      members: string[];
    };
    const big = buildShowcase(100).find((e) => e.key.endsWith("set:tags")) as {
      members: string[];
    };
    expect(big.members.length).toBe(small.members.length + 100);
  });

  it("bulk=0 still emits the full curated gallery (every kind)", () => {
    const present = new Set(buildShowcase(0).map((e) => e.kind));
    for (const kind of KINDS) expect(present).toContain(kind);
  });
});
