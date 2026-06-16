import { CompletionContext } from "@codemirror/autocomplete";
import type { CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  REDIS_COMMAND_COMPLETIONS,
  REDIS_UNSUPPORTED_COMMAND_FAMILIES,
  VALKEY_COMMAND_COMPLETIONS,
  createRedisCommandCompletionSource,
  type RedisCommandCompletionTarget,
  type RedisKeySuggestion,
} from "./redisCommandCompletion";

const BACKEND_ALLOWLIST = [
  "SCAN",
  "KEYS",
  "GET",
  "HGETALL",
  "LRANGE",
  "SMEMBERS",
  "ZRANGE",
  "XRANGE",
  "TYPE",
  "TTL",
  "EXISTS",
  "SET",
  "HSET",
  "LPUSH",
  "RPUSH",
  "SADD",
  "ZADD",
  "EXPIRE",
  "PERSIST",
  "DEL",
] as const;

const KEY_SUGGESTIONS = [
  { key: "profile:1", keyType: "string" },
  { key: "profiles:list", keyType: "list" },
  { key: "profiles:set", keyType: "set" },
  { key: "profiles:zset", keyType: "zSet" },
  { key: "profiles:hash", keyType: "hash" },
  { key: "profiles:stream", keyType: "stream" },
] as const satisfies readonly RedisKeySuggestion[];

function runSource(
  doc: string,
  explicit = true,
  keySuggestions: readonly RedisKeySuggestion[] = [],
  target: RedisCommandCompletionTarget = "redis",
) {
  const state = EditorState.create({ doc });
  const source = createRedisCommandCompletionSource({
    keySuggestions,
    target,
  });
  const result = source(new CompletionContext(state, doc.length, explicit));
  if (result instanceof Promise) {
    throw new Error("Redis command completion source must be synchronous");
  }
  return result;
}

function labels(result: CompletionResult | null): string[] {
  if (!result) return [];
  return result.options.map((option) => option.label);
}

describe("redis command completion vocabulary", () => {
  it("matches the bounded backend command allowlist", () => {
    expect(REDIS_COMMAND_COMPLETIONS.map((command) => command.name)).toEqual([
      ...BACKEND_ALLOWLIST,
    ]);
  });

  it("covers arity, argument hints, and snippets for every command", () => {
    for (const command of REDIS_COMMAND_COMPLETIONS) {
      expect(command.arity).not.toHaveLength(0);
      expect(command.arguments.length).toBeGreaterThan(0);
      expect(command.snippet).toContain(command.name);
      expect(command.summary).not.toHaveLength(0);
    }

    expect(
      REDIS_COMMAND_COMPLETIONS.find((command) => command.name === "XRANGE"),
    ).toMatchObject({
      arity: "key start end [COUNT n]",
      arguments: ["key", "start", "end", "COUNT"],
      snippet: "XRANGE ${key} - + COUNT 100",
    });
    expect(
      REDIS_COMMAND_COMPLETIONS.find((command) => command.name === "ZRANGE"),
    ).toMatchObject({
      arguments: ["key", "start", "stop", "WITHSCORES"],
      snippet: "ZRANGE ${key} 0 99 WITHSCORES",
    });
  });

  it("documents unsupported families without surfacing them as candidates", () => {
    expect(REDIS_UNSUPPORTED_COMMAND_FAMILIES.length).toBeGreaterThanOrEqual(5);
    expect(labels(runSource("FLU"))).toEqual([]);
    expect(labels(runSource("XG"))).toEqual([]);
    expect(labels(runSource("PUB"))).toEqual([]);
    expect(labels(runSource("REN"))).toEqual([]);
  });

  it("suggests command names by first-token prefix only", () => {
    expect(labels(runSource("XR"))).toEqual(["XRANGE"]);
    expect(labels(runSource("SC"))).toEqual(["SCAN"]);
    expect(labels(runSource("KE"))).toEqual(["KEYS"]);
    expect(labels(runSource("  z"))).toEqual(["ZRANGE", "ZADD"]);
    expect(labels(runSource("GET "))).toEqual([]);
    expect(labels(runSource("SET session:1"))).toEqual([]);
  });

  it("keeps destructive suggestions lower priority and clearly labeled", () => {
    const del = REDIS_COMMAND_COMPLETIONS.find(
      (command) => command.name === "DEL",
    );
    expect(del).toMatchObject({
      effect: "destructive",
      arity: "1 key + exact confirmKey",
    });

    const result = runSource("D");
    if (!result) {
      throw new Error("expected synchronous Redis command completions");
    }
    expect(result.options).toHaveLength(1);
    expect(result.options[0]).toMatchObject({
      label: "DEL",
      detail: "1 key + exact confirmKey",
      boost: -50,
    });
  });

  it("requires explicit completion for an empty command token", () => {
    expect(labels(runSource("", false))).toEqual([]);
    expect(labels(runSource("", true))).toEqual([...BACKEND_ALLOWLIST]);
  });

  it("suggests current-DB keys when the cursor is on a key argument", () => {
    expect(labels(runSource("GET pro", true, KEY_SUGGESTIONS))).toEqual([
      "profile:1",
    ]);
    expect(labels(runSource("LRANGE profiles", true, KEY_SUGGESTIONS))).toEqual(
      ["profiles:list"],
    );
    expect(
      labels(runSource("HGETALL profiles", true, KEY_SUGGESTIONS)),
    ).toEqual(["profiles:hash"]);
    expect(labels(runSource("ZRANGE profiles", true, KEY_SUGGESTIONS))).toEqual(
      ["profiles:zset"],
    );
    expect(labels(runSource("XRANGE profiles", true, KEY_SUGGESTIONS))).toEqual(
      ["profiles:stream"],
    );
  });

  it("keeps type-agnostic commands open to every cached key type", () => {
    expect(labels(runSource("TTL profiles", true, KEY_SUGGESTIONS))).toEqual([
      "profiles:list",
      "profiles:set",
      "profiles:zset",
      "profiles:hash",
      "profiles:stream",
    ]);
    expect(
      labels(runSource("EXISTS profiles:", true, KEY_SUGGESTIONS)),
    ).toEqual([
      "profiles:list",
      "profiles:set",
      "profiles:zset",
      "profiles:hash",
      "profiles:stream",
    ]);
  });

  it("does not block or synthesize key completions when the scan cache is empty", () => {
    expect(labels(runSource("GET pro", true))).toEqual([]);
    expect(labels(runSource("GET ", false, KEY_SUGGESTIONS))).toEqual([]);
    expect(labels(runSource("GET ", true, KEY_SUGGESTIONS))).toEqual([
      "profile:1",
    ]);
  });

  it("does not suggest keys past the first key argument for fixed-arity commands", () => {
    expect(
      labels(runSource("HSET profiles:hash field", true, KEY_SUGGESTIONS)),
    ).toEqual([]);
    expect(
      labels(
        runSource("EXISTS profiles:list profiles:", true, KEY_SUGGESTIONS),
      ),
    ).toEqual([
      "profiles:list",
      "profiles:set",
      "profiles:zset",
      "profiles:hash",
      "profiles:stream",
    ]);
  });

  it("treats SCAN cursor and KEYS pattern as non-key arguments", () => {
    expect(labels(runSource("SCAN ", true, KEY_SUGGESTIONS))).toEqual([]);
    expect(labels(runSource("KEYS pro", true, KEY_SUGGESTIONS))).toEqual([]);
  });

  it("uses the proven Valkey command subset as the Valkey vocabulary source", () => {
    expect(VALKEY_COMMAND_COMPLETIONS.map((command) => command.name)).toEqual([
      "GET",
      "HGETALL",
      "LRANGE",
      "SMEMBERS",
      "ZRANGE",
      "XRANGE",
      "TYPE",
      "TTL",
      "EXISTS",
      "SET",
      "EXPIRE",
      "PERSIST",
      "DEL",
    ]);
    expect(labels(runSource("", true, [], "valkey"))).toEqual(
      VALKEY_COMMAND_COMPLETIONS.map((command) => command.name),
    );
    expect(labels(runSource("H", true, [], "valkey"))).toEqual(["HGETALL"]);
    expect(labels(runSource("L", true, [], "valkey"))).toEqual(["LRANGE"]);
    expect(labels(runSource("SM", true, [], "valkey"))).toEqual(["SMEMBERS"]);
    expect(labels(runSource("Z", true, [], "valkey"))).toEqual(["ZRANGE"]);
  });

  it("keeps Valkey key suggestions on the proven current-keyspace commands", () => {
    expect(
      labels(runSource("GET pro", true, KEY_SUGGESTIONS, "valkey")),
    ).toEqual(["profile:1"]);
    expect(
      labels(runSource("HGETALL profiles", true, KEY_SUGGESTIONS, "valkey")),
    ).toEqual(["profiles:hash"]);
    expect(
      labels(runSource("LRANGE profiles", true, KEY_SUGGESTIONS, "valkey")),
    ).toEqual(["profiles:list"]);
    expect(
      labels(runSource("SMEMBERS profiles", true, KEY_SUGGESTIONS, "valkey")),
    ).toEqual(["profiles:set"]);
    expect(
      labels(runSource("ZRANGE profiles", true, KEY_SUGGESTIONS, "valkey")),
    ).toEqual(["profiles:zset"]);
    expect(
      labels(runSource("XRANGE profiles", true, KEY_SUGGESTIONS, "valkey")),
    ).toEqual(["profiles:stream"]);
    expect(
      labels(runSource("TTL profiles", true, KEY_SUGGESTIONS, "valkey")),
    ).toEqual([
      "profiles:list",
      "profiles:set",
      "profiles:zset",
      "profiles:hash",
      "profiles:stream",
    ]);
  });
});
