// SchemaGraph → text ERD export (issue #1661, ADR 0054 detail decision 5).
// mermaid `erDiagram` and DBML are text, so they diff and paste straight into
// docs. SVG / PNG raster and UI wiring live outside this module (second pass
// after the #1655 canvas replacement).
//
// Pure module: no React / IPC / IO. The SOT for relationships is the single
// `foreign-key-table` edge of SchemaGraph (`selectSchemaGraphForeignKeys`), so
// column flags are not re-interpreted here — that is what keeps the FK marks
// on attributes and the relationship lines from diverging. Virtual FKs
// (#1659) are undelivered and out of scope; FKs synthesized from column flags
// where a constraint catalog is missing (SQLite) ride along as the real edges
// the graph already created.
//
// **No syntax claim in this file is guesswork.** The evidence comes in two
// kinds, and each constant says which one it is: the mermaid attribute rules
// are transcribed from the lexer of the pinned `mermaid@11.16.0` (comment
// above `mermaidWord`), while the rest — characters quoted strings reject,
// DBML's missing escape — were measured with the parsers. `mermaid` and
// `@dbml/core` ship as devDependencies, and "exporter output parses with the
// real parsers" in `schemaGraphTextExport.test.ts` feeds this module's output
// straight into `mermaid.parse()` / `Parser.parse(…, "dbml")`. If you touch a
// character class or a fallback, re-measure with those round-trip and sweep
// tests — a guess-fixed escape has already been a defect twice in a row
// (#2097).
import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphColumnNode,
  SchemaGraphForeignKeyEndpoint,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
import { extractSchemaGraph } from "./schemaGraph";
import {
  selectSchemaGraphForeignKeys,
  selectSchemaGraphNodeMaps,
} from "./schemaGraphSelectors";
import type { SchemaGraphForeignKeySelection } from "./schemaGraphSelectorTypes";
import { schemaGraphTableId, sortById } from "./schemaGraphSupport";

export type SchemaGraphTextExportInput =
  | SchemaGraph
  | SchemaGraphCatalogSnapshot;

/**
 * Renders a SchemaGraph as mermaid `erDiagram` text. Entity names are
 * schema-qualified as `"schema.table"`, and columns are written as
 * `type name PK, FK`. The parent-side cardinality of a relationship is `|o`
 * (zero or one) when any FK source column is nullable, and `||` (exactly one)
 * when all are NOT NULL — under SQL MATCH SIMPLE the FK is not checked when
 * any source column is NULL.
 *
 * A table whose columns have not loaded yet stays as an empty entity block —
 * mermaid accepts empty blocks (measured by the round-trip test). DBML does
 * not, so `schemaGraphToDbml` handles that case differently.
 */
export function schemaGraphToMermaid(
  input: SchemaGraphTextExportInput,
): string {
  const model = toExportModel(input);
  const lines: string[] = ["erDiagram"];
  // Sanitizing can collapse distinct sources to the same string (`a@b` and
  // `a$b` both become `a_b`). mermaid does parse duplicate entities and
  // attributes, but then the two tables merge into one entity and the two
  // columns show on one line — dedupe with the same rule as the DBML side.
  const takenEntityNames = new Set<string>();
  const entityNameByTableId = new Map<string, string>();

  for (const { node, columns } of model.tables) {
    const entity = takeUniqueName(takenEntityNames, mermaidEntityName(node));
    entityNameByTableId.set(node.id, entity);
    lines.push(`    "${entity}" {`);

    const takenColumnNames = new Set<string>();
    for (const column of columns) {
      const keys: string[] = [];
      if (column.data.is_primary_key) keys.push("PK");
      if (model.foreignKeyColumnIds.has(column.id)) keys.push("FK");
      const suffix = keys.length > 0 ? ` ${keys.join(", ")}` : "";
      const name = takeUniqueName(takenColumnNames, mermaidWord(column.column));
      lines.push(
        `        ${mermaidWord(column.data.data_type)} ${name}${suffix}`,
      );
    }
    lines.push("    }");
  }

  for (const foreignKey of model.foreignKeys) {
    const source = entityNameByTableId.get(foreignKey.sourceTableId);
    const target = entityNameByTableId.get(foreignKey.targetTableId);
    // Draw the line only when both ends were actually printed. Snapshot input
    // is already filtered by the graph, but a direct `SchemaGraph` is a public
    // input of this module.
    if (!source || !target) continue;
    const parentSide = isOptionalForeignKey(model, foreignKey) ? "|o" : "||";
    lines.push(
      `    "${source}" }o--${parentSide} "${target}" : ${mermaidQuoted(
        foreignKey.relationship.rawMetadata.constraintName,
      )}`,
    );
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Renders a SchemaGraph as DBML text. Table blocks come first, and `Ref:`
 * lines are gathered after them — dbdiagram.io does not require the referenced
 * table to appear first, so the order is fixed for diff readability. An empty
 * graph yields an empty string.
 *
 * A table with no columns is kept as a single `//` comment line instead of a
 * block, and the `Ref:` lines touching that table are dropped as well. See the
 * `dbmlSkipsColumnlessTable` comment for the rationale.
 */
export function schemaGraphToDbml(input: SchemaGraphTextExportInput): string {
  const model = toExportModel(input);
  const blocks: string[] = [];
  const declared = new Map<string, DeclaredDbmlTable>();
  const tableNamesBySchema = new Map<string, Set<string>>();

  for (const { node, columns } of model.tables) {
    if (columns.length === 0) {
      blocks.push(dbmlSkipsColumnlessTable(node));
      continue;
    }
    const schema = dbmlIdentifier(node.schema);
    const takenTables = tableNamesBySchema.get(schema) ?? new Set<string>();
    tableNamesBySchema.set(schema, takenTables);
    const table = takeUniqueName(takenTables, dbmlIdentifier(node.table));
    const takenColumns = new Set<string>();
    const columnNames = new Map<string, string>();

    const body = columns.map((column) => {
      const name = takeUniqueName(takenColumns, dbmlIdentifier(column.column));
      columnNames.set(column.column, name);
      const settings: string[] = [];
      if (column.data.is_primary_key) settings.push("pk");
      if (!column.data.nullable) settings.push("not null");
      const suffix = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      return `  "${name}" ${dbmlType(column.data.data_type)}${suffix}`;
    });

    declared.set(node.id, { schema, table, columnNames });
    blocks.push([`Table "${schema}"."${table}" {`, ...body, "}"].join("\n"));
  }

  // A `Ref:` pointing at an undeclared table or column makes the parser reject
  // the whole document (measured: `Can't find field "x" in table "t"`). Only
  // names actually printed above pass through, so an omitted table, a table
  // missing from the graph, and a column the catalog did not deliver are all
  // caught by this one decision.
  const refLines = model.foreignKeys.map((foreignKey) =>
    dbmlRefLine(declared, foreignKey),
  );
  // Two byte-identical `Ref:` lines are also rejected by the parser
  // (measured). Two FK constraints with different names over the same column
  // pair produce identical lines here because this module does not carry the
  // constraint name — fold the duplicates.
  const refs = [...new Set(refLines.filter((line) => line !== null))];
  if (refs.length > 0) blocks.push(refs.join("\n"));

  const omitted = refLines.filter((line) => line === null).length;
  if (omitted > 0) {
    // The omission comment only names tables — relationships dropped along
    // with them are counted here too.
    blocks.push(
      `// omitted ${omitted} reference(s) to tables or columns that are not declared above`,
    );
  }

  return blocks.length > 0 ? `${blocks.join("\n\n")}\n` : "";
}

interface DeclaredDbmlTable {
  readonly schema: string;
  readonly table: string;
  /** Catalog column name → name actually printed. `Ref:` lines read only through this map. */
  readonly columnNames: ReadonlyMap<string, string>;
}

// Name collisions inside one scope make the parser reject the whole document
// — measured: `Field "a" existed in table "t"`, `Table "t" existed`. Sanitizing
// can fold distinct sources to the same string (e.g. `a"b` and `a_b`), so
// disambiguate with a suffix.
function takeUniqueName(taken: Set<string>, candidate: string): string {
  let name = candidate;
  for (let suffix = 2; taken.has(name); suffix += 1) {
    name = `${candidate}_${suffix}`;
  }
  taken.add(name);
  return name;
}

function dbmlRefLine(
  declared: ReadonlyMap<string, DeclaredDbmlTable>,
  foreignKey: SchemaGraphForeignKeySelection,
): string | null {
  const source = dbmlEndpoint(declared, foreignKey.relationship.source);
  const target = dbmlEndpoint(declared, foreignKey.relationship.target);
  return source && target ? `Ref: ${source} > ${target}` : null;
}

// DBML cannot parse a `Table` block with no body — `@dbml/core` rejects it
// with `Expected comment, valid name, or whitespace but "}" found`, and one
// broken block invalidates the whole DBML document, so a single table can
// make the entire export unusable (#2097).
//
// Zero columns is not an error state. The catalog ships the table list first
// and fills columns asynchronously after mount (`?? []` in
// `schemaGraphCatalog.ts`), so exporting mid-load is a common path. Do not
// invent columns; record only the omission as a comment — comments are syntax
// DBML accepts at the top level. Engines like Postgres really do allow
// zero-column tables, so the wording does not assert a cause.
function dbmlSkipsColumnlessTable(node: SchemaGraphTableNode): string {
  return `// skipped table ${dbmlTableName(node)}: no columns available`;
}

interface ExportTable {
  readonly node: SchemaGraphTableNode;
  readonly columns: readonly SchemaGraphColumnNode[];
}

interface ExportModel {
  readonly tables: readonly ExportTable[];
  readonly tablesById: ReadonlyMap<string, SchemaGraphTableNode>;
  readonly columnsById: ReadonlyMap<string, SchemaGraphColumnNode>;
  readonly foreignKeys: readonly SchemaGraphForeignKeySelection[];
  readonly foreignKeyColumnIds: ReadonlySet<string>;
}

function toExportModel(input: SchemaGraphTextExportInput): ExportModel {
  // Call only the two selectors needed instead of the heavy
  // `selectSchemaGraphIntelligence` — that one also flattens the graph once,
  // but runs two extra passes this module never reads: the diagnostics index
  // and per-table metadata readiness.
  // ponytail: `"nodes" in input` re-derives `schemaGraphSelectors`' private
  // `isCatalogSnapshot` with the inverted key — now that a third declaration
  // exists (the same union in selectors · diff · here), exporting the guard
  // and the type from one side would be better, but that touches files
  // outside this PR.
  const graph: SchemaGraph =
    "nodes" in input ? input : extractSchemaGraph(input);
  const nodeMaps = selectSchemaGraphNodeMaps(graph);
  const { tablesById, columnsById, columnsByTableId } = nodeMaps;
  const { foreignKeys } = selectSchemaGraphForeignKeys(graph, nodeMaps);

  return {
    tables: sortById([...tablesById.values()]).map((node) => ({
      node,
      // The graph's column map is sorted by id (percent-encoded name), which
      // rearranges unusual names. Follow the graph's own `ordinal` — that
      // value is the index **after** `sortByName` (`schemaGraph.ts`), so the
      // result is alphabetical by column name, not DDL physical order. This
      // layer has no way to recover the physical order.
      columns: [...(columnsByTableId.get(node.id) ?? [])].sort(
        (left, right) => left.ordinal - right.ordinal,
      ),
    })),
    tablesById,
    columnsById,
    foreignKeys,
    foreignKeyColumnIds: new Set(
      foreignKeys.flatMap((foreignKey) => foreignKey.sourceColumnIds),
    ),
  };
}

function isOptionalForeignKey(
  model: ExportModel,
  foreignKey: SchemaGraphForeignKeySelection,
): boolean {
  // Treat a missing column node as optional — with nullability unknown, `||`
  // (exactly one) would draw a constraint that may not exist, the worse lie.
  return foreignKey.sourceColumnIds.some(
    (columnId) => model.columnsById.get(columnId)?.data.nullable ?? true,
  );
}

function mermaidEntityName(node: SchemaGraphTableNode): string {
  // Sanitize schema and table separately, then join — sanitizing the joined
  // text leaves inner spaces behind, as in `public. tbl`.
  return `${mermaidSafeText(node.schema)}.${mermaidSafeText(node.table)}`;
}

// Entity names and relationship labels are quoted-string tokens, a different
// situation from attributes. The lexer rule is `/^(?:"[^"]*")/i` — a single
// `"` delimiter ends the token and everything inside is accepted. So the
// question here closes as **one delimiter plus preprocessing that runs before
// lexing**, not "how many more dangerous characters are there" (the open
// question that took four rounds on attributes): `%` starts a comment (`%%`),
// `\` is caught by the preprocessing, and control characters break the line —
// all three measured with the parsers, and the sweep re-measures them on every
// run in five spots. Postgres allows all three inside quoted identifiers, so
// user data reaches here.
// ponytail: labels therefore keep raw text like `numeric(10,2)` — there is no
// reason to narrow them to a grammar subset the way attributes are. Only
// `a"b`, `a%b`, and `a\b` fold into one name; move up to the alias
// (`entity["label"]`) notation if distinguishing them becomes necessary.
const MERMAID_STRING_REJECTS = /["%\\]/g;
const CONTROL_OR_SPACE = /[\p{Cc}\p{Cf}\s]+/gu;

function mermaidQuoted(value: string): string {
  return `"${mermaidSafeText(value)}"`;
}

function mermaidSafeText(value: string): string {
  const safe = value
    .replace(CONTROL_OR_SPACE, " ")
    .replace(MERMAID_STRING_REJECTS, "_")
    .trim();
  // The token requires at least one character — empty quotes are a parse
  // error.
  return safe.length > 0 ? safe : "unnamed";
}

// A mermaid attribute is a word token that cannot contain quotes. The three
// below are **transcribed verbatim from the erDiagram lexer rules** of the
// `mermaid@11.16.0` pinned by this PR, not a list picked by measurement. The
// source is the lexer `rules` array in that package's
// `dist/chunks/mermaid.esm/erDiagram-*.mjs`, and only two of its rules can be
// reached by our output in the attribute position:
//
//   ATTRIBUTE_KEY   /^(?:\b((?:PK)|(?:FK)|(?:UK))\b)/i
//   ATTRIBUTE_WORD  /^(?:([*A-Za-z_\u00C0-\uFFFF][A-Za-z0-9\-_[\]().,\u00C0-\uFFFF*]*))/i
//
// (The rule between them, `([^\s]*)[~].*[~]([^\s]*)`, requires `~`, and `~`
// is removed below, so it can never match.)
//
// **Enumerating and stripping dangerous characters was abandoned.** That
// structure is an open set that gains a line for every new counterexample,
// and #2097 produced counterexamples in four consecutive rounds. Instead the
// output token is confined **by construction** to a subset of the language
// the two rules above accept — the remaining question changes from "is this
// character dangerous" (endless) to "did we transcribe the grammar classes
// right" (checking one file settles it).
//
// ponytail: labels are mangled — `numeric(10,2)` becomes `numeric_10_2_`, and
// `a@b` and `a$b` both become `a_b`. Owner decision to lose the label rather
// than emit an invalid document (2026-08-02, PR #2097); preserving the
// original text reopens when upstream's backtick notation
// (mermaid-js/mermaid#5138) merges.

// ATTRIBUTE_WORD's tail class minus the delimiters (`- . , ( ) [ ] *`).
// Delimiters are legal in the grammar, but the lexer tries ATTRIBUTE_KEY
// first, so a reserved-word prefix like `pk-a` splits the token and breaks
// the whole document (#2097).
// The `u` flag is deliberately omitted — the grammar is written with code-unit
// ranges (`\u00C0-\uFFFF`), which is what lets astral characters through as
// surrogate pairs exactly like the lexer.
const MERMAID_WORD_REJECTS = /[^A-Za-z0-9_\u00C0-\uFFFF]/g;
// ATTRIBUTE_WORD's head class minus `*` (already removed above). Of the
// tokens that survived the replacements above, only ones starting with a
// digit miss this.
const MERMAID_WORD_HEAD = /^[A-Za-z_\u00C0-\uFFFF]/;
// Copied verbatim from the ATTRIBUTE_KEY rule. `\b` is an ASCII word
// boundary, so as soon as a token merely **starts** with that word, a
// following character outside `[A-Za-z0-9_]` drops it out as the key marker —
// `pk` (alone)·`pk` + a non-word suffix·`pḱ` are all caught here, while
// `pka`·`pk_`·`pk1` are not. The previous code, which demanded an exact match
// (`^(pk|fk|uk)$`), let the first two through.
const MERMAID_RESERVED_WORDS = /^(?:PK|FK|UK)\b/i;

function mermaidWord(value: string): string {
  // Send whitespace-only types/names to the placeholder instead of padding
  // with `_` — same rule as `dbmlType`'s empty-value handling.
  const cleaned = value.trim().replace(MERMAID_WORD_REJECTS, "_");
  if (cleaned.length === 0) return "unknown";
  // One leading `_` settles both fixes at once: ATTRIBUTE_KEY's
  // `\b(PK|FK|UK)\b` no longer matches, and `_` itself is inside the head
  // class.
  if (MERMAID_RESERVED_WORDS.test(cleaned)) return `_${cleaned}`;
  return MERMAID_WORD_HEAD.test(cleaned) ? cleaned : `_${cleaned}`;
}

function dbmlTableName(node: SchemaGraphTableNode): string {
  return `${dbmlQuoted(node.schema)}.${dbmlQuoted(node.table)}`;
}

function endpointTableId(endpoint: SchemaGraphForeignKeyEndpoint): string {
  return schemaGraphTableId(endpoint.schema, endpoint.table);
}

function dbmlEndpoint(
  declared: ReadonlyMap<string, DeclaredDbmlTable>,
  endpoint: SchemaGraphForeignKeyEndpoint,
): string | null {
  const table = declared.get(endpointTableId(endpoint));
  if (!table) return null;
  const columns = endpoint.columns.map((column) =>
    table.columnNames.get(column),
  );
  if (columns.some((column) => column === undefined)) return null;

  const qualifier = `"${table.schema}"."${table.table}"`;
  const quoted = columns.map((column) => `"${column}"`);
  // Single columns in plain form, only composite keys as a parenthesized
  // list — both forms come from the dbdiagram.io docs.
  return quoted.length === 1
    ? `${qualifier}.${quoted[0]}`
    : `${qualifier}.(${quoted.join(", ")})`;
}

const DBML_BARE_TYPE = /^[A-Za-z_][A-Za-z0-9_]*(\([A-Za-z0-9_, ]*\))?$/;

function dbmlType(dataType: string): string {
  const trimmed = dataType.trim();
  if (trimmed.length === 0) return dbmlQuoted("unknown");
  return DBML_BARE_TYPE.test(trimmed) ? trimmed : dbmlQuoted(trimmed);
}

// DBML quoted identifiers have **no escape syntax** — measured: `@dbml/core`
// rejects both `"a\"b"` and `"a""b"`, and `\` is not an escape but a plain
// character, so `"a\b"` passes through with the name `a\b`. So backslash is
// left as-is and only `"` is lowered to `_` by the same rule as mermaid.
//
// Empty identifiers (`""`) and newlines are rejected by the parser, so
// newlines and control characters fold to spaces, and if trimming both ends
// leaves nothing, use the placeholder — same wording as `mermaidSafeText`.
function dbmlQuoted(value: string): string {
  return `"${dbmlIdentifier(value)}"`;
}

function dbmlIdentifier(value: string): string {
  const safe = value.replace(CONTROL_OR_SPACE, " ").replaceAll('"', "_").trim();
  return safe.length > 0 ? safe : "unnamed";
}
