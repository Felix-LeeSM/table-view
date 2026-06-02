import { CompletionContext } from "@codemirror/autocomplete";
import type { CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  REDIS_COMMAND_COMPLETIONS,
  REDIS_UNSUPPORTED_COMMAND_FAMILIES,
  createRedisCommandCompletionSource,
} from "./redisCommandCompletion";

const BACKEND_ALLOWLIST = [
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

function runSource(doc: string, explicit = true) {
  const state = EditorState.create({ doc });
  const source = createRedisCommandCompletionSource();
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
});
