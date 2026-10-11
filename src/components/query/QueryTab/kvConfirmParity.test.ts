import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KV_CONFIRM_COMMANDS } from "./kvCommandConfirmation";

// `process.cwd()` is the vitest root (the repo root).
const RUST_PATH = "src-tauri/table-view-core/src/db/redis/command_parser.rs";

/** A Rust string literal, char literal, line comment or block comment. A
 * literal is matched whole, so a `//` inside one never starts a comment. Raw
 * strings are read as plain strings and block comments as non-nesting. */
const RUST_LEXEME =
  /"(?:\\[\s\S]|[^"\\])*"|'(?:\\(?:x..|u\{[^}]*\}|.)|[^'\\])'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;

/** The text between the braces of `fn <name>`, paired by depth so the
 * `{ .. }` patterns inside it do not end it. */
function fnBody(code: string, name: string): string {
  const start = code.search(new RegExp(String.raw`\bfn ${name}\b`));
  const open = start < 0 ? -1 : code.indexOf("{", start);
  if (open >= 0) {
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "{") depth += 1;
      if (code[i] === "}") {
        depth -= 1;
        if (depth === 0) return code.slice(open + 1, i);
      }
    }
  }
  throw new Error(`no \`fn ${name}\` body read from ${RUST_PATH}`);
}

/** Variant names in the `effect()` arms that evaluate to
 * `RedisCommandEffect::Destructive`. */
function destructiveVariants(code: string): string[] {
  const body = fnBody(code, "effect");
  const arms = [...body.matchAll(/=>\s*RedisCommandEffect::(\w+)/g)];
  // An arm whose right side is anything else (a block, an `if`) would be read
  // as part of the next arm, and its variants would move there unnoticed.
  if (arms.length !== (body.match(/=>/g) ?? []).length) {
    throw new Error(
      `an \`effect()\` arm in ${RUST_PATH} does not evaluate straight to a ` +
        "`RedisCommandEffect` variant — teach this test to read it",
    );
  }
  const variants: string[] = [];
  let from = 0;
  for (const arm of arms) {
    if (arm[1] === "Destructive") {
      const patterns = body.slice(from, arm.index);
      for (const [, variant] of patterns.matchAll(/RedisCommand::(\w+)/g)) {
        if (variant !== undefined) variants.push(variant);
      }
    }
    from = arm.index + arm[0].length;
  }
  return variants;
}

/** Verbs `parse_redis_command` dispatches on: the string literals in its match
 * arm patterns (`"DEL" =>`, `"LPUSH" | "RPUSH" =>`). */
function parserVerbs(code: string): Set<string> {
  const body = fnBody(code, "parse_redis_command");
  const verbs = new Set<string>();
  for (const [, verb] of body.matchAll(/"([^"\\]+)"(?=\s*(?:\||=>))/g)) {
    if (verb !== undefined) verbs.add(verb);
  }
  return verbs;
}

// Purpose: the `losesData: true` entries of KV_CONFIRM_COMMANDS mirror the
// backend's Destructive verbs by hand; compare the two so a verb on one side
// only fails here — issue #2528 (2026-10-11)
describe("KV confirm map vs the backend Destructive verbs", () => {
  // Reason: a Destructive verb left out of the map is classified `info` and
  // dispatched with no confirm dialog, and nothing compared the map with
  // command_parser.rs before this test (#2528) (2026-10-11)
  it("[kv-confirm-parity] the map's losesData: true verbs equal effect()'s Destructive arm", () => {
    const code = readFileSync(resolve(process.cwd(), RUST_PATH), "utf8")
      // Blank the comments only: the verb literals have to survive.
      .replace(RUST_LEXEME, (lexeme) =>
        lexeme.startsWith("/") ? " " : lexeme,
      );
    const variants = destructiveVariants(code);
    // A reader that misses hands back an empty set; fail on that by name
    // rather than as a set diff.
    expect(
      variants,
      `no RedisCommandEffect::Destructive variant read from ${RUST_PATH}`,
    ).not.toHaveLength(0);
    const verbs = parserVerbs(code);
    expect(
      variants.filter((variant) => !verbs.has(variant.toUpperCase())),
      "Destructive variant(s) whose upper-cased name is not a verb " +
        "parse_redis_command dispatches on — teach this test their verb",
    ).toEqual([]);
    const back = [
      ...new Set(variants.map((variant) => variant.toUpperCase())),
    ].sort();
    const front = Object.entries(KV_CONFIRM_COMMANDS)
      .filter(([, command]) => command.losesData)
      .map(([verb]) => verb)
      .sort();
    expect(
      front,
      `KV_CONFIRM_COMMANDS losesData: true (received) vs ${RUST_PATH} ` +
        "effect() Destructive (expected)",
    ).toEqual(back);
  });
});
