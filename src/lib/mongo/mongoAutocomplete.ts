import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

/** Minimal shape of a lezer SyntaxNode — we only walk `.parent` and read
 * `.name` / offsets, so restating the needed subset keeps this module free
 * of a direct `@lezer/common` dependency. */
interface MinimalSyntaxNode {
  readonly name: string;
  readonly from: number;
  readonly to: number;
  readonly parent: MinimalSyntaxNode | null;
  readonly firstChild: MinimalSyntaxNode | null;
}

/**
 * MongoDB MQL vocabulary — pure module, no React / Zustand dependencies.
 *
 * Sprint 83 surfaces these lists to the document paradigm query editor so
 * users see the same autocomplete quality as SQL tabs. The lists are
 * intentionally conservative — only operators/stages/accumulators the
 * Sprint 83 contract enumerates are included so the candidate set is
 * deterministic and testable. Future sprints can extend these arrays.
 */

/**
 * Filter / query operators usable inside a `find` filter body or inside a
 * `$match` / `$expr` stage. The contract's AC-01 requires every entry in
 * this list to be surfaced as an autocomplete candidate when the editor
 * cursor sits at a `$`-prefixed key position in find mode.
 */
export const MONGO_QUERY_OPERATORS = [
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$and",
  "$or",
  "$nor",
  "$not",
  "$exists",
  "$type",
  "$regex",
  "$elemMatch",
  "$size",
  "$all",
] as const;

/**
 * Aggregation pipeline stages. Offered at the top-level key position inside
 * the outermost pipeline array (aggregate mode) — AC-02.
 */
export const MONGO_AGGREGATE_STAGES = [
  "$match",
  "$project",
  "$group",
  "$sort",
  "$limit",
  "$skip",
  "$unwind",
  "$lookup",
  "$count",
  "$addFields",
  "$replaceRoot",
  "$facet",
  "$out",
  "$merge",
] as const;

/**
 * Group accumulators (usable inside `$group`, `$addFields`, etc.). Offered
 * when the cursor is at a non-top-level key position in aggregate mode —
 * AC-03.
 */
export const MONGO_ACCUMULATORS = [
  "$sum",
  "$avg",
  "$min",
  "$max",
  "$push",
  "$addToSet",
  "$first",
  "$last",
  "$count",
] as const;

/**
 * BSON extended-JSON type tags. Offered at value positions (after a `:`)
 * in both modes so users can write `{ "_id": { "$oid": "..." } }` — AC-04.
 */
export const MONGO_TYPE_TAGS = [
  "$oid",
  "$date",
  "$numberLong",
  "$numberDouble",
  "$numberInt",
  "$numberDecimal",
  "$binary",
  "$regularExpression",
  "$timestamp",
  "$minKey",
  "$maxKey",
  "$symbol",
  "$code",
] as const;

/**
 * Flat union of every operator-like identifier the MQL vocabulary knows
 * about. Used by the operator highlight decoration to colour these
 * strings distinctly from ordinary JSON values.
 */
export const MONGO_ALL_OPERATORS: readonly string[] = [
  ...MONGO_QUERY_OPERATORS,
  ...MONGO_AGGREGATE_STAGES,
  ...MONGO_ACCUMULATORS,
  ...MONGO_TYPE_TAGS,
];

export type MongoQueryMode = "find" | "aggregate";

export interface MongoCompletionOptions {
  queryMode: MongoQueryMode;
  /**
   * Cached field names for the active collection — surfaced as autocomplete
   * candidates when the cursor is at a JSON key position (AC-05). Optional
   * because not every tab will have an inferred field set yet; an empty or
   * missing list is tolerated without throwing (AC test for empty fields).
   */
  fieldNames?: readonly string[];
}

/**
 * Classification of the JSON context around the cursor. Sprint 83 uses a
 * deliberately simple heuristic — see `classifyPosition` — rather than a
 * full scope analysis. The contract permits this level of imprecision.
 */
type PositionKind =
  | "stage-key" // top-level object key inside a pipeline array (aggregate mode)
  | "accumulator-or-filter-key" // nested object key position
  | "value" // after `:`, inside a value expression
  | "unknown";

/**
 * Build an autocomplete `CompletionSource` that serves MQL-aware candidates.
 *
 * The source triggers on:
 * - A `$`-prefixed identifier fragment (any position) — returns operator /
 *   stage / accumulator / type-tag candidates depending on the classified
 *   position and query mode.
 * - A quote-opened key fragment (`"foo`) — returns the supplied `fieldNames`
 *   wrapped in double quotes.
 *
 * Returns `null` (no candidates) when:
 * - The cursor is inside an unquoted string body (no `$` and no matching
 *   quoted key token).
 * - The classifier falls back to `"unknown"` with no triggering token.
 */
export function createMongoCompletionSource(
  opts: MongoCompletionOptions,
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const dollarMatch = context.matchBefore(/\$[a-zA-Z]*/);
    const quotedKeyMatch = context.matchBefore(/"[A-Za-z0-9_.$-]*/);

    // Dollar-prefixed token wins when present — it unambiguously signals
    // an operator / stage / accumulator / type-tag candidate position.
    if (dollarMatch) {
      const position = classifyPosition(context);
      const candidates: Completion[] = [];
      appendDollarCandidates(candidates, opts.queryMode, position);
      if (candidates.length === 0) return null;
      return {
        from: dollarMatch.from,
        options: candidates,
        validFor: /^\$[a-zA-Z]*$/,
      };
    }

    // Quoted key fragment → offer field names (key position only). We scope
    // this to key positions so ordinary string-value typing doesn't pull up
    // a field-name popup mid-sentence.
    if (quotedKeyMatch && opts.fieldNames && opts.fieldNames.length > 0) {
      const position = classifyPosition(context);
      if (position === "value" || position === "unknown") {
        // Field names only make sense as object keys; suppress the popup
        // elsewhere so users writing `"active": "..."` don't see noise.
        return null;
      }
      const candidates: Completion[] = opts.fieldNames.map((name) => ({
        label: `"${name}"`,
        apply: `"${name}"`,
        type: "property",
      }));
      return {
        from: quotedKeyMatch.from,
        options: candidates,
        validFor: /^"[A-Za-z0-9_.$-]*$/,
      };
    }

    return null;
  };
}

/**
 * Heuristic JSON position classifier. Intentionally shallow — the contract
 * explicitly allows "simple heuristic, no deep scope analysis". The rules:
 *
 * 1. Walk ancestors to find the innermost `Object` / `Array`.
 * 2. Scan the document up to the cursor and find the last *meaningful*
 *    non-whitespace, non-quote character. The character classifies the slot:
 *      - `{` or `,`  → key position
 *      - `:`         → value position
 *      - `[`         → stage-key (top-level aggregate slot)
 * 3. If the innermost `Object` sits directly inside an `Array`, treat key
 *    positions as `stage-key`. Otherwise nested-object key positions become
 *    `accumulator-or-filter-key`.
 *
 * Imprecision this accepts on purpose:
 *  - `$lookup`'s nested `pipeline: [...]` isn't rewalked — inner stages are
 *    reported as nested keys (accumulator-or-filter-key) rather than
 *    stage-keys. Good enough for Sprint 83; a future refinement can track
 *    `$lookup`/`$facet` recursion.
 *  - Positions inside string values return `unknown` (the string body has
 *    no `:` / `,` right before the cursor).
 */
function classifyPosition(context: CompletionContext): PositionKind {
  const { state, pos } = context;
  const tree = syntaxTree(state);
  const node = tree.resolveInner(pos, -1) as unknown as MinimalSyntaxNode;

  // Cursor inside a String literal → value position (JSON strings can live
  // as object values or array items, both handled identically by MQL).
  for (let cur: MinimalSyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "String") {
      // However: a string that's the PropertyName of an enclosing Property
      // (i.e. we're typing a key) is a key position, not a value position.
      if (cur.parent && cur.parent.name === "Property") {
        // PropertyName is the Property's first child; if cur is literally
        // that first child we're inside the key.
        const propName = cur.parent.firstChild;
        if (propName && propName.from === cur.from && propName.to === cur.to) {
          return nearestObjectIsInArray(cur)
            ? "stage-key"
            : "accumulator-or-filter-key";
        }
      }
      return "value";
    }
    if (cur.name === "PropertyName") {
      return nearestObjectIsInArray(cur)
        ? "stage-key"
        : "accumulator-or-filter-key";
    }
    if (cur.name === "Object" || cur.name === "Array") break;
  }

  // Outside a string: inspect the last non-whitespace character up to pos.
  // This covers the common "just typed `$` after `{`, `,`, or `:`" path.
  const upToCursor = state.doc.sliceString(0, pos);
  const lastChar = lastMeaningfulChar(upToCursor);

  if (lastChar === ":") return "value";
  if (lastChar === "{" || lastChar === ",") {
    // Key position — check the enclosing object's parent.
    return closestObjectIsInArray(tree, pos)
      ? "stage-key"
      : "accumulator-or-filter-key";
  }
  if (lastChar === "[") {
    // Just after array open: the next object will be a stage.
    return "stage-key";
  }

  return "unknown";
}

/** Last non-whitespace, non-string-body character preceding `pos`. Scans
 * backwards through the partial source. Stops at the first printable char.
 * Returns `null` when nothing meaningful precedes the cursor. */
function lastMeaningfulChar(upToCursor: string): string | null {
  for (let i = upToCursor.length - 1; i >= 0; i--) {
    const ch = upToCursor[i]!;
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") continue;
    // Skip anything that's part of a currently-typed `$keyword` or quoted
    // identifier so we report the *enclosing* punctuation instead.
    if (/[A-Za-z0-9_$"]/.test(ch)) continue;
    return ch;
  }
  return null;
}

/** True when walking up from `node` we find an `Object` whose parent is an
 * `Array`. Used to distinguish top-level pipeline stages (object inside
 * array) from nested objects. */
function nearestObjectIsInArray(node: MinimalSyntaxNode): boolean {
  for (let cur: MinimalSyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "Object") {
      const parent = cur.parent;
      return parent?.name === "Array";
    }
  }
  return false;
}

/** Variant that starts from a doc offset — used when the cursor is outside
 * any string node. */
function closestObjectIsInArray(
  tree: ReturnType<typeof syntaxTree>,
  pos: number,
): boolean {
  const node = tree.resolveInner(pos, -1) as unknown as MinimalSyntaxNode;
  for (let cur: MinimalSyntaxNode | null = node; cur; cur = cur.parent) {
    if (cur.name === "Object") {
      const parent = cur.parent;
      return parent?.name === "Array";
    }
  }
  return false;
}

function appendDollarCandidates(
  out: Completion[],
  mode: MongoQueryMode,
  position: PositionKind,
): void {
  if (position === "value") {
    // Value position → BSON extended JSON type tags (e.g. `{ "$oid": "..." }`).
    pushOperators(out, MONGO_TYPE_TAGS, "type");
    return;
  }

  if (mode === "aggregate") {
    if (position === "stage-key") {
      pushOperators(out, MONGO_AGGREGATE_STAGES, "keyword");
      return;
    }
    if (position === "accumulator-or-filter-key") {
      // In an aggregate pipeline but nested inside a stage: accumulators +
      // the standard query operators (for `$match`'s body, which re-uses
      // the find operator set).
      pushOperators(out, MONGO_ACCUMULATORS, "function");
      pushOperators(out, MONGO_QUERY_OPERATORS, "keyword");
      return;
    }
    // Unknown: conservatively offer everything aggregate-aware so the user
    // always sees candidates instead of a silent empty popup.
    pushOperators(out, MONGO_AGGREGATE_STAGES, "keyword");
    pushOperators(out, MONGO_ACCUMULATORS, "function");
    pushOperators(out, MONGO_QUERY_OPERATORS, "keyword");
    return;
  }

  // Find mode — always query operators on key positions.
  if (
    position === "stage-key" ||
    position === "accumulator-or-filter-key" ||
    position === "unknown"
  ) {
    pushOperators(out, MONGO_QUERY_OPERATORS, "keyword");
  }
}

function pushOperators(
  out: Completion[],
  list: readonly string[],
  type: string,
): void {
  for (const label of list) {
    out.push({ label, apply: label, type });
  }
}

/**
 * Decoration extension that marks JSON string / property-name tokens whose
 * text matches a known MQL operator. The token receives the
 * `cm-mql-operator` CSS class so themes can style it distinctly (blue in
 * the default theme). Viewport-scoped so very large documents stay O(N)
 * over the visible range only.
 */
export function createMongoOperatorHighlight(): Extension {
  const operatorSet = new Set(MONGO_ALL_OPERATORS);
  const mark = Decoration.mark({ class: "cm-mql-operator" });

  function build(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      syntaxTree(view.state).iterate({
        from,
        to,
        enter: (node) => {
          if (node.name !== "String" && node.name !== "PropertyName") return;
          const raw = view.state.doc.sliceString(node.from, node.to);
          // JSON strings always include their surrounding quotes; strip
          // them before matching against the operator set.
          const unquoted = stripJsonQuotes(raw);
          if (operatorSet.has(unquoted)) {
            builder.add(node.from, node.to, mark);
          }
        },
      });
    }
    return builder.finish();
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.selectionSet
        ) {
          this.decorations = build(update.view);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
}

function stripJsonQuotes(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}
