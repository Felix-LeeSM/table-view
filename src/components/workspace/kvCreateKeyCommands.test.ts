import { describe, expect, it } from "vitest";
import {
  buildCreateKeyPlan,
  emptyCreateForm,
  type KvCreateForm,
  type KvCreateType,
} from "./kvCreateKeyCommands";

// Purpose: the type-first new-key composer must build exactly the command that
// runs (preview == execution) with every operand quoted through redisToken, and
// must refuse an aggregate with no first value (Redis discards empty
// collections). Pure builder, so these are the lowest layer that can hold the
// fact (testing-scenarios P1).

function form(type: KvCreateType, over: Partial<KvCreateForm>): KvCreateForm {
  return { ...emptyCreateForm(type), key: "k", ...over };
}

function planOf(f: KvCreateForm) {
  const built = buildCreateKeyPlan(f);
  if (!built.ok) throw new Error(`expected ok, got error ${built.error.key}`);
  return built.plan;
}

describe("buildCreateKeyPlan — per-type command", () => {
  it("string → SET key value NX and runs via the typed string command", () => {
    const plan = planOf(form("string", { stringValue: "Ada" }));
    expect(plan.via).toBe("string");
    expect(plan.command).toBe("SET k Ada NX");
    expect(plan.value).toBe("Ada");
  });

  it("string with TTL appends EX seconds", () => {
    const plan = planOf(form("string", { stringValue: "Ada", ttl: "60" }));
    expect(plan.command).toBe("SET k Ada NX EX 60");
    expect(plan.ttlSeconds).toBe(60);
  });

  it("json → JSON.SET key $ <normalized-json>", () => {
    const plan = planOf(form("json", { jsonValue: '{ "a" : 1 }' }));
    expect(plan.via).toBe("command");
    // Round-tripped so the preview is exactly what runs.
    expect(plan.command).toBe('JSON.SET k $ "{\\"a\\":1}"');
  });

  it("hash → HSET with quoted field/value pairs", () => {
    const plan = planOf(
      form("hash", {
        pairs: [
          { a: "name", b: "Ada Lovelace" },
          { a: "role", b: "eng" },
        ],
      }),
    );
    expect(plan.command).toBe('HSET k name "Ada Lovelace" role eng');
  });

  it("list → RPUSH with quoted elements", () => {
    const plan = planOf(form("list", { items: ["a", "b c"] }));
    expect(plan.command).toBe('RPUSH k a "b c"');
  });

  it("set → SADD with quoted members", () => {
    const plan = planOf(form("set", { items: ["m1", "m 2"] }));
    expect(plan.command).toBe('SADD k m1 "m 2"');
  });

  it("zSet → ZADD with raw score and quoted member", () => {
    const plan = planOf(form("zSet", { pairs: [{ a: "1.5", b: "alpha" }] }));
    expect(plan.command).toBe("ZADD k 1.5 alpha");
  });

  it("stream → XADD with id and quoted field/value pairs", () => {
    const plan = planOf(
      form("stream", { streamId: "*", pairs: [{ a: "f", b: "v v" }] }),
    );
    expect(plan.command).toBe('XADD k * f "v v"');
  });
});

describe("buildCreateKeyPlan — validation", () => {
  it("requires a key name", () => {
    const built = buildCreateKeyPlan(form("string", { key: "  " }));
    expect(built).toEqual({
      ok: false,
      error: { key: "kvNewKey.error.keyRequired" },
    });
  });

  it.each<[KvCreateType, string]>([
    ["hash", "kvNewKey.error.emptyHash"],
    ["list", "kvNewKey.error.emptyList"],
    ["set", "kvNewKey.error.emptySet"],
    ["zSet", "kvNewKey.error.emptyZset"],
    ["stream", "kvNewKey.error.emptyStream"],
  ])("%s with zero first values is blocked", (type, key) => {
    // Aggregate types cannot create empty (Redis GCs an empty collection).
    const built = buildCreateKeyPlan(form(type, {}));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.key).toBe(key);
  });

  it("rejects invalid JSON before execution", () => {
    const built = buildCreateKeyPlan(form("json", { jsonValue: "{ not json" }));
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.key).toBe("kvNewKey.error.invalidJson");
  });

  it("rejects a non-positive TTL", () => {
    const built = buildCreateKeyPlan(
      form("string", { stringValue: "x", ttl: "0" }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok)
      expect(built.error.key).toBe("kvNewKey.error.ttlNotPositive");
  });

  it("rejects a non-numeric zSet score", () => {
    const built = buildCreateKeyPlan(
      form("zSet", { pairs: [{ a: "high", b: "alpha" }] }),
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.error.key).toBe("kvNewKey.error.zsetScore");
  });
});

describe("buildCreateKeyPlan — injection safety", () => {
  it("collapses an injection value into a single quoted token", () => {
    const plan = planOf(form("set", { items: ['"; FLUSHALL'] }));
    // The whole payload is one quoted token — no second command escapes.
    expect(plan.command).toBe('SADD k "\\"; FLUSHALL"');
  });
});
