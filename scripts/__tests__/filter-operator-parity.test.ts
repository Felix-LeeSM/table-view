import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const TS_PATH = "src/types/schema.ts";
const RUST_PATH = "src-tauri/table-view-core/src/models/schema/core.rs";

/** String-literal members of the top-level `type <name> = ...` in a TS file,
 * or [] when the file has no such alias. A member that is not a string
 * literal throws: skipping it would shrink the set this test compares. */
function tsUnionMembers(path: string, name: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(resolve(repoRoot, path), "utf8"),
    ts.ScriptTarget.Latest,
  );
  const alias = source.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === name,
  );
  if (alias === undefined) return [];
  const members = ts.isUnionTypeNode(alias.type)
    ? alias.type.types
    : [alias.type];
  return members.map((member) => {
    if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
      return member.literal.text;
    }
    throw new Error(
      `\`${member.getText(source)}\` in \`type ${name}\` (${path}) is not a ` +
        "string literal — teach this test to read it",
    );
  });
}

/** Variant names of `enum <name>` in a Rust file, or [] when there is none.
 * serde puts a variant on the wire under its Rust name unless a
 * `#[serde(...)]` attribute says otherwise
 * (https://serde.rs/variant-attrs.html, https://serde.rs/container-attrs.html),
 * so a serde attribute on the enum or on a variant throws instead of being
 * guessed at, and so does a variant that is not a plain unit variant. */
function rustEnumVariants(path: string, name: string): string[] {
  // Comments go first, so that a doc comment does not reach the readers below
  // and a commented-out declaration reads as absent. String literals are
  // matched so that a comment marker inside one survives.
  const code = readFileSync(resolve(repoRoot, path), "utf8").replace(
    /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (token) => (token.startsWith('"') ? token : " "),
  );
  const declarations = [
    ...code.matchAll(
      new RegExp(
        String.raw`((?:#\[[^\]]*\]\s*)*)(?:pub(?:\([^)]*\))?\s+)?enum\s+${name}\s*\{([^}]*)\}`,
        "g",
      ),
    ),
  ];
  if (declarations.length > 1) {
    throw new Error(`${path} declares \`enum ${name}\` more than once`);
  }
  const [, attributes = "", body = ""] = declarations[0] ?? [];
  if (/\bserde\b/.test(attributes + body)) {
    throw new Error(
      `a #[serde(...)] attribute on \`enum ${name}\` (${path}) can change ` +
        "how its variants go on the wire — teach this test to read it",
    );
  }
  const variant = /\s*(?:#\[[^\]]*\]\s*)*([A-Za-z_]\w*)\s*(?:,|$)/y;
  const variants: string[] = [];
  while (body.slice(variant.lastIndex).trim() !== "") {
    const rest = body.slice(variant.lastIndex).trim();
    const match = variant.exec(body);
    if (match?.[1] === undefined) {
      throw new Error(
        `\`enum ${name}\` (${path}) has a variant this test cannot read: ` +
          `\`${rest.split("\n")[0]}\``,
      );
    }
    variants.push(match[1]);
  }
  return variants;
}

const sortedUnique = (names: string[]): string[] => [...new Set(names)].sort();

// Purpose: the FilterOperator TS union and Rust enum are each written by hand on
// one side of the IPC boundary; keep their wire names equal — issue #2494 (2026-10-11)
describe("FilterOperator TS<->Rust parity", () => {
  // Reason: tsc never reads the Rust enum and cargo never reads the TS union, so
  // nothing compared the two declarations before this test (#2494) (2026-10-11)
  it("[filter-operator-parity] the TS union and the Rust enum carry the same wire names", () => {
    const front = tsUnionMembers(TS_PATH, "FilterOperator");
    const back = rustEnumVariants(RUST_PATH, "FilterOperator");
    // Two extractors that both miss would compare equal as empty sets, so a
    // declaration that moved or changed shape has to fail here first.
    expect(
      front,
      `no FilterOperator members read from ${TS_PATH}`,
    ).not.toHaveLength(0);
    expect(
      back,
      `no FilterOperator variants read from ${RUST_PATH}`,
    ).not.toHaveLength(0);
    expect(
      sortedUnique(front),
      `${TS_PATH} union (received) vs ${RUST_PATH} enum (expected)`,
    ).toEqual(sortedUnique(back));
  });
});
