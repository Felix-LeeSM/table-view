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
import {
  classifyMongoCompletionPosition,
  type MongoCompletionPositionKind,
} from "@lib/mongo/mongoCompletionPosition";
import { getMongoCompletionVocabulary } from "@lib/mongo/mongoCompletionVocabulary";
import {
  getMongoAdminCommandCompletions,
  getMongoshCollectionMethodCompletions,
  getMongoshDbLevelMethodCompletions,
} from "@lib/mongo/mongoShellCompletionVocabulary";
import { MONGO_OPERATOR_META } from "@lib/mongo/mongoOperatorMeta";

export { classifyMongoCompletionPosition } from "@lib/mongo/mongoCompletionPosition";
export type { MongoCompletionPositionKind } from "@lib/mongo/mongoCompletionPosition";
export {
  MONGO_ACCUMULATORS,
  MONGO_AGGREGATE_STAGES,
  MONGO_ALL_OPERATORS,
  MONGO_EXPRESSION_OPERATORS,
  MONGO_PROJECTION_OPERATORS,
  MONGO_QUERY_OPERATORS,
  MONGO_TYPE_TAGS,
  MONGO_UPDATE_OPERATORS,
  getMongoCompletionVocabulary,
} from "@lib/mongo/mongoCompletionVocabulary";
export {
  getMongoAdminCommandCompletions,
  getMongoshCollectionMethodCompletions,
  getMongoshDbLevelMethodCompletions,
  MONGO_ADMIN_COMMANDS,
  MONGOSH_DB_LEVEL_METHODS,
  MONGOSH_DB_METHODS,
} from "@lib/mongo/mongoShellCompletionVocabulary";

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
      const position = classifyMongoCompletionPosition(context);
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
      const position = classifyMongoCompletionPosition(context);
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

function appendDollarCandidates(
  out: Completion[],
  mode: MongoQueryMode,
  position: MongoCompletionPositionKind,
): void {
  const vocabulary = getMongoCompletionVocabulary();
  if (position === "value") {
    // Value position → BSON extended JSON type tags (e.g. `{ "$oid": "..." }`).
    pushOperators(out, vocabulary.typeTags, "type");
    return;
  }

  if (mode === "aggregate") {
    if (position === "stage-key") {
      pushOperators(out, vocabulary.aggregateStages, "keyword");
      return;
    }
    if (position === "accumulator-or-filter-key") {
      // In an aggregate pipeline but nested inside a stage: accumulators +
      // the standard query operators (for `$match`'s body, which re-uses
      // the find operator set).
      pushOperators(out, vocabulary.accumulators, "function");
      pushOperators(out, vocabulary.expressionOperators, "function");
      pushOperators(out, vocabulary.updateOperators, "keyword");
      pushOperators(out, vocabulary.projectionOperators, "keyword");
      pushOperators(out, vocabulary.queryOperators, "keyword");
      return;
    }
    // Unknown: conservatively offer everything aggregate-aware so the user
    // always sees candidates instead of a silent empty popup.
    pushOperators(out, vocabulary.aggregateStages, "keyword");
    pushOperators(out, vocabulary.accumulators, "function");
    pushOperators(out, vocabulary.expressionOperators, "function");
    pushOperators(out, vocabulary.updateOperators, "keyword");
    pushOperators(out, vocabulary.projectionOperators, "keyword");
    pushOperators(out, vocabulary.queryOperators, "keyword");
    return;
  }

  // Find mode — always query operators on key positions.
  if (
    position === "stage-key" ||
    position === "accumulator-or-filter-key" ||
    position === "unknown"
  ) {
    pushOperators(out, vocabulary.queryOperators, "keyword");
  }
}

function pushOperators(
  out: Completion[],
  list: readonly string[],
  type: string,
): void {
  for (const label of list) {
    // 2026-05-15 — UX 옵션 5/6: 알려진 operator 면 시그니처(detail)와
    // 한 줄 설명(info)을 같이 surface. 누락된 토큰은 label only 로 fall
    // through 해서 popup 이 깨지지 않는다.
    const meta = MONGO_OPERATOR_META[label];
    out.push({
      label,
      apply: label,
      type,
      detail: meta?.detail,
      info: meta?.info,
    });
  }
}

/**
 * CodeMirror `CompletionSource` that fires when the cursor sits right
 * after `db.` or `db.<collectionName>.` and surfaces the mongosh
 * collection-method whitelist (`find`, `aggregate`, `insertOne`, etc.).
 *
 * Why a second source: the existing `createMongoCompletionSource`
 * triggers on `$`-prefixed tokens and quoted key fragments. Those
 * patterns only match once the user has already opened a JSON body —
 * which makes typing `db.users.fi` give no candidates, the exact gap
 * the user hit. This source closes that gap so the editor finally
 * earns the "fully featured autocomplete" claim Phase 28 promised.
 *
 * Collection names are pulled from `collectionNames` when the caller
 * has them cached (typically the connection's `fieldsCache` keys).
 * When the cache is empty the source still fires for the
 * `db.` → method case so the user always sees the method whitelist.
 */
export interface MongoshDbSourceOptions {
  /** Active collection in the current query tab. */
  activeCollectionName?: string;
  /** Known collection names for the active database. Sourced from the
   *  schema/document store; may be empty until the user has browsed
   *  the database in the sidebar. */
  collectionNames?: readonly string[];
  /**
   * Known index names for the active collection. Used only in index-name
   * argument positions such as `db.users.dropIndex("...")`.
   */
  indexNames?: readonly string[];
}

export function createMongoshDbSource(
  opts: MongoshDbSourceOptions = {},
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const upTo = context.state.doc.sliceString(0, context.pos);

    const indexNameMatch =
      /\bdb\.([A-Za-z_][A-Za-z0-9_]*)\.dropIndex\(\s*"([^"]*)$/.exec(upTo);
    if (indexNameMatch) {
      if (indexNameMatch[1] !== opts.activeCollectionName) return null;
      const prefix = indexNameMatch[2] ?? "";
      const from = context.pos - prefix.length;
      const indexNames = (opts.indexNames ?? []).filter(
        (name) => name !== "_id_",
      );
      if (indexNames.length === 0) return null;
      return {
        from,
        options: indexNames.map((name) => ({
          label: name,
          apply: name,
          type: "variable",
          detail: "index",
        })),
        validFor: /^[^"]*$/,
      };
    }

    const methodMatch = /\bdb\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_]*)$/.exec(
      upTo,
    );
    if (methodMatch) {
      const prefix = methodMatch[2] ?? "";
      const from = context.pos - prefix.length;
      const options: Completion[] = getMongoshCollectionMethodCompletions().map(
        (cand) => ({
          label: cand.label,
          apply: cand.label,
          type: cand.type,
          detail: cand.detail,
          info: cand.info,
        }),
      );
      return {
        from,
        options,
        validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
      };
    }

    const collectionMatch = /\bdb\.([A-Za-z_][A-Za-z0-9_]*)?$/.exec(upTo);
    if (collectionMatch) {
      const prefix = collectionMatch[1] ?? "";
      const from = context.pos - prefix.length;
      const collections = opts.collectionNames ?? [];
      // Sprint 381 (2026-05-17) — always surface the db-level helpers
      // (`runCommand`, `adminCommand`, …) at this position so the user
      // who types `db.r` lands directly on `runCommand` without having
      // to remember the parens trick. Collection names come *after* the
      // db-level helpers when both apply.
      const dbLevel: Completion[] = getMongoshDbLevelMethodCompletions().map(
        (cand) => ({
          label: cand.label,
          apply: cand.label,
          type: cand.type,
          detail: cand.detail,
          info: cand.info,
        }),
      );
      const options: Completion[] =
        collections.length > 0
          ? [
              ...dbLevel,
              ...collections.map((name) => ({
                label: name,
                apply: name,
                type: "class",
              })),
            ]
          : // No cached collection list yet — surface the method whitelist
            // anyway so the popup is never empty after `db.`. The user
            // can still type the collection name manually; the popup
            // keeps `find`/`aggregate`/... visible as the muscle-memory
            // affordance the user expects from a mongosh prompt.
            [
              ...dbLevel,
              ...getMongoshCollectionMethodCompletions().map((cand) => ({
                label: cand.label,
                apply: cand.label,
                type: cand.type,
                detail: cand.detail,
                info: cand.info,
              })),
            ];
      return {
        from,
        options,
        validFor: /^[A-Za-z0-9_]*$/,
      };
    }

    return null;
  };
}

/**
 * Sprint 381 (2026-05-17) — `db.runCommand({` / `db.adminCommand({` 다음
 * 위치에서 admin command literal (`serverStatus`, `dbStats`, `ping`, …) 을
 * 추천하는 CompletionSource.
 *
 * 동작:
 *   - 정규식 `\b(runCommand|adminCommand)\s*\(\s*\{\s*([A-Za-z_$][A-Za-z0-9_$]*)?$`
 *     에 매칭되면 admin command 후보를 surface. 첫 키 위치에서만 발동
 *     — 두번째 key 부터는 BSON-key autocompletion 의 영역이라 noisy 회피.
 *   - `apply` 는 `<name>: <default>` 형태 (예: `serverStatus: 1`) 라
 *     사용자가 한 keystroke 으로 valid command body 를 얻는다.
 *
 * AST 가 아닌 정규식 기반 — sprint-382 가 AST 로 promote 예정.
 */
export function createMongoAdminCommandSource(): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const upTo = context.state.doc.sliceString(0, context.pos);
    // Match the first key position inside `db.runCommand({` / `db.adminCommand({`.
    // The key fragment ([2]) may be empty when the cursor just opened the
    // brace. Subsequent keys (after a comma) are out of scope so the popup
    // doesn't pollute filter / option bodies.
    const m =
      /\b(runCommand|adminCommand)\s*\(\s*\{\s*([A-Za-z_$][A-Za-z0-9_$]*)?$/.exec(
        upTo,
      );
    if (!m) return null;
    const prefix = m[2] ?? "";
    const from = context.pos - prefix.length;
    const options: Completion[] = getMongoAdminCommandCompletions().map(
      (cand) => ({
        label: cand.label,
        apply: cand.apply,
        type: "keyword",
        detail: cand.detail,
        info: cand.info,
      }),
    );
    return {
      from,
      options,
      validFor: /^[A-Za-z0-9_$]*$/,
    };
  };
}

/**
 * Decoration extension that marks JSON string / property-name tokens whose
 * text matches a known MQL operator. The token receives the
 * `cm-mql-operator` CSS class so themes can style it distinctly (blue in
 * the default theme). Viewport-scoped so very large documents stay O(N)
 * over the visible range only.
 */
export function createMongoOperatorHighlight(): Extension {
  const operatorSet = new Set(getMongoCompletionVocabulary().allOperators);
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
