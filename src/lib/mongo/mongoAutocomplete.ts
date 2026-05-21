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
} from "./mongoCompletionPosition";
import { MONGOSH_METHOD_WHITELIST } from "./mongoshParser";

export { classifyMongoCompletionPosition } from "./mongoCompletionPosition";
export type { MongoCompletionPositionKind } from "./mongoCompletionPosition";

/**
 * MongoDB MQL vocabulary — pure module, no React / Zustand deps. Lists
 * are intentionally conservative; the candidate set stays deterministic
 * and testable, and can be extended as needs surface.
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

/**
 * mongosh collection methods surfaced after `db.<collection>.`. Mirrors
 * the legacy `dbMethodCandidates` list in `src/lib/completion/mongo.ts`
 * (re-exported below for backward-compat) but now lives here because
 * the CodeMirror-friendly `createMongoshDbSource` is the only live
 * consumer and the older `createDbMethodCompletionSource` is no longer
 * wired to the editor. Kept aligned with the Phase 28 method whitelist
 * in `docs/phases/phase-28.md`.
 */
export const MONGOSH_DB_METHODS: ReadonlyArray<{
  label: string;
  type: "function";
  /** Inline signature surfaced as `Completion.detail`. */
  detail: string;
  /** One-liner surfaced in the right-side `Completion.info` panel. */
  info: string;
}> = [
  {
    label: "find",
    type: "function",
    detail: "(filter?, options?)",
    info: "Return a cursor over documents matching the filter.",
  },
  {
    label: "findOne",
    type: "function",
    detail: "(filter, options?)",
    info: "Return the first document matching the filter, or null.",
  },
  {
    label: "aggregate",
    type: "function",
    detail: "(pipeline, options?)",
    info: "Run an aggregation pipeline and return the resulting cursor.",
  },
  {
    label: "countDocuments",
    type: "function",
    detail: "(filter?, options?)",
    info: "Exact count of documents matching the filter.",
  },
  {
    label: "estimatedDocumentCount",
    type: "function",
    detail: "(options?)",
    info: "Fast metadata-based count of all documents (no filter).",
  },
  {
    label: "distinct",
    type: "function",
    detail: "(field, filter?, options?)",
    info: "Distinct values of `field` for documents matching the filter.",
  },
  {
    label: "insertOne",
    type: "function",
    detail: "(doc, options?)",
    info: "Insert a single document; returns the inserted `_id`.",
  },
  {
    label: "insertMany",
    type: "function",
    detail: "(docs[], options?)",
    info: "Insert multiple documents in order (or unordered with options).",
  },
  {
    label: "updateOne",
    type: "function",
    detail: "(filter, update, options?)",
    info: "Update the first document matching the filter.",
  },
  {
    label: "updateMany",
    type: "function",
    detail: "(filter, update, options?)",
    info: "Update every document matching the filter.",
  },
  {
    label: "replaceOne",
    type: "function",
    detail: "(filter, replacement, options?)",
    info: "Replace the matched document wholesale (preserves `_id`).",
  },
  {
    label: "deleteOne",
    type: "function",
    detail: "(filter, options?)",
    info: "Delete the first document matching the filter.",
  },
  {
    label: "deleteMany",
    type: "function",
    detail: "(filter, options?)",
    info: "Delete every document matching the filter.",
  },
  {
    label: "createIndex",
    type: "function",
    detail: "(keys, options?)",
    info: "Create an index on the given key spec (e.g. `{ email: 1 }`).",
  },
  {
    label: "dropIndex",
    type: "function",
    detail: "(indexName)",
    info: "Drop the named index from the collection.",
  },
  {
    label: "bulkWrite",
    type: "function",
    detail: "(operations, options?)",
    info: "Run multiple write operations in one ordered or unordered batch.",
  },
];

const MONGOSH_DB_METHOD_LABELS = new Set(
  MONGOSH_DB_METHODS.map((method) => method.label),
);

for (const method of MONGOSH_METHOD_WHITELIST) {
  if (!MONGOSH_DB_METHOD_LABELS.has(method)) {
    throw new Error(
      `mongosh autocomplete missing whitelisted method: ${method}`,
    );
  }
}

/**
 * Sprint 381 (2026-05-17) — mongosh top-level helpers that don't belong on
 * `db.<collection>.`. Surfaced when the user types `db.<prefix>` (no
 * second dot yet) so `runCommand` / `adminCommand` autocomplete the
 * generic admin-command path that bypasses the Phase 28 method
 * whitelist. The Phase 28 collection methods stay on
 * {@link MONGOSH_DB_METHODS}; this list is the *db-level* method set
 * (collection-context absent).
 */
export const MONGOSH_DB_LEVEL_METHODS: ReadonlyArray<{
  label: string;
  type: "function";
  detail: string;
  info: string;
}> = [
  {
    label: "runCommand",
    type: "function",
    detail: "({<cmd>: <arg>, …})",
    info: "Send an arbitrary admin/diagnostic command to the bound database. mongosh's universal escape hatch — `serverStatus`, `dbStats`, `collStats`, `ping`, …",
  },
  {
    label: "adminCommand",
    type: "function",
    detail: "({<cmd>: <arg>, …})",
    info: "Send an admin command (always targets the `admin` database regardless of the toolbar chip).",
  },
  {
    label: "getCollection",
    type: "function",
    detail: "(name)",
    info: "Return a collection handle by name. Useful when the collection name is not a valid JS identifier.",
  },
  {
    label: "getCollectionNames",
    type: "function",
    detail: "()",
    info: "List collection names in the current database.",
  },
  {
    label: "getCollectionInfos",
    type: "function",
    detail: "()",
    info: "List collection metadata (name + options) in the current database.",
  },
  {
    label: "getProfilingStatus",
    type: "function",
    detail: "()",
    info: "Return the profiling level and slow-ms threshold for the current database.",
  },
  {
    label: "setProfilingLevel",
    type: "function",
    detail: "(level, slowms?)",
    info: "Enable / disable profiling. `level` ∈ {0=off, 1=slow ops, 2=all ops}.",
  },
];

/**
 * Sprint 381 (2026-05-17) — admin / diagnostic commands the user can drop
 * inside `db.runCommand({...})` / `db.adminCommand({...})`. mongosh 의
 * 모든 admin helper 가 본질적으로 `runCommand` wrapper 이므로, 이 dict
 * 만 갖춰도 가장 흔한 진단 / 메타 시나리오를 cover.
 *
 * 각 entry 는 `apply` value 에 `name: 1` 을 박아넣어, 사용자가 한
 * keystroke 으로 valid command body 를 얻을 수 있게 한다.
 */
export const MONGO_ADMIN_COMMANDS: ReadonlyArray<{
  label: string;
  apply: string;
  detail: string;
  info: string;
}> = [
  {
    label: "ping",
    apply: "ping: 1",
    detail: "1",
    info: "No-op health check. Returns `{ok: 1}` when the server is reachable.",
  },
  {
    label: "serverStatus",
    apply: "serverStatus: 1",
    detail: "1",
    info: "Comprehensive runtime stats (connections / mem / repl / network / …).",
  },
  {
    label: "hostInfo",
    apply: "hostInfo: 1",
    detail: "1",
    info: "OS / CPU / memory information about the host running mongod.",
  },
  {
    label: "buildInfo",
    apply: "buildInfo: 1",
    detail: "1",
    info: "mongod version, git commit, OS, modules, max bson size.",
  },
  {
    label: "listDatabases",
    apply: "listDatabases: 1",
    detail: "1",
    info: "Enumerate every database visible to the connected user (admin-context).",
  },
  {
    label: "listCollections",
    apply: "listCollections: 1",
    detail: "1 | {filter, …}",
    info: "Enumerate collections in the bound database (with optional filter).",
  },
  {
    label: "dbStats",
    apply: "dbStats: 1",
    detail: "1 | {scale}",
    info: "Storage size + index size + collection count for the bound database.",
  },
  {
    label: "collStats",
    apply: 'collStats: "<collection>"',
    detail: '"<coll>"',
    info: "Storage / index stats for a specific collection.",
  },
  {
    label: "currentOp",
    apply: 'currentOp: 1, "$all": true',
    detail: "1",
    info: "List currently running operations (admin-context).",
  },
  {
    label: "killOp",
    apply: "killOp: 1, op: <opid>",
    detail: "1, op",
    info: "Terminate a running operation by id (admin-context).",
  },
  {
    label: "getCmdLineOpts",
    apply: "getCmdLineOpts: 1",
    detail: "1",
    info: "Argv + parsed config the mongod process was started with.",
  },
  {
    label: "setProfilingLevel",
    apply: "profile: 1, slowms: 100",
    detail: "0|1|2",
    info: "Enable / disable the database profiler (0=off, 1=slow ops, 2=all).",
  },
  {
    label: "getProfilingStatus",
    apply: "profile: -1",
    detail: "-1",
    info: "Return current profiling level + slow-ms threshold for the bound database.",
  },
  {
    label: "validate",
    apply: 'validate: "<collection>"',
    detail: '"<coll>"',
    info: "Verify the on-disk integrity of a collection's data + indexes (slow).",
  },
  {
    label: "create",
    apply: 'create: "<collection>"',
    detail: '"<coll>"',
    info: "Create a new collection in the bound database (advanced — for options see MongoDB docs).",
  },
  {
    label: "drop",
    apply: 'drop: "<collection>"',
    detail: '"<coll>"',
    info: "Drop a collection from the bound database.",
  },
  {
    label: "dropDatabase",
    apply: "dropDatabase: 1",
    detail: "1",
    info: "Drop the bound database. **Destructive** — no undo.",
  },
  {
    label: "isMaster",
    apply: "isMaster: 1",
    detail: "1",
    info: "Legacy replica-set status probe (returns `ismaster`, `setName`, `hosts`, …).",
  },
  {
    label: "hello",
    apply: "hello: 1",
    detail: "1",
    info: "Modern replacement for `isMaster` — returns replica-set / sharding topology metadata.",
  },
  {
    label: "replSetGetStatus",
    apply: "replSetGetStatus: 1",
    detail: "1",
    info: "Replica-set member health + oplog progress (admin-context).",
  },
];

/**
 * Per-operator metadata for `Completion.detail` (inline signature) and
 * `Completion.info` (right-side help panel). The list is intentionally a
 * lookup map so the per-operator entry is colocated with the trigger
 * token; missing entries fall through to a default surface (label only).
 */
const OPERATOR_META: Record<string, { detail: string; info: string }> = {
  // Query operators
  $eq: { detail: "value", info: "Matches values equal to the operand." },
  $ne: { detail: "value", info: "Matches values not equal to the operand." },
  $gt: { detail: "value", info: "Strictly greater than the operand." },
  $gte: { detail: "value", info: "Greater than or equal to the operand." },
  $lt: { detail: "value", info: "Strictly less than the operand." },
  $lte: { detail: "value", info: "Less than or equal to the operand." },
  $in: { detail: "[…]", info: "Matches any value in the given array." },
  $nin: { detail: "[…]", info: "Matches values not in the given array." },
  $and: { detail: "[expr,…]", info: "All sub-expressions must match." },
  $or: { detail: "[expr,…]", info: "At least one sub-expression must match." },
  $nor: { detail: "[expr,…]", info: "None of the sub-expressions match." },
  $not: { detail: "expr", info: "Negates the inner expression." },
  $exists: { detail: "boolean", info: "Field exists (true) / absent (false)." },
  $type: {
    detail: "bsonType",
    info: "Matches documents where the field has the given BSON type.",
  },
  $regex: {
    detail: "regex",
    info: "Matches strings against a regular expression.",
  },
  $elemMatch: {
    detail: "{…}",
    info: "At least one array element matches the inner expression.",
  },
  $size: {
    detail: "number",
    info: "Matches arrays of exactly the given length.",
  },
  $all: { detail: "[…]", info: "Array contains every listed value." },

  // Aggregation stages
  $match: {
    detail: "{filter}",
    info: "Filter documents to those matching the predicate.",
  },
  $project: {
    detail: "{spec}",
    info: "Reshape documents — include / exclude / compute fields.",
  },
  $group: {
    detail: "{_id, …}",
    info: "Group documents by `_id` and apply accumulators.",
  },
  $sort: {
    detail: "{field: 1|-1}",
    info: "Sort the pipeline (1 = asc, -1 = desc).",
  },
  $limit: { detail: "n", info: "Keep only the first n documents." },
  $skip: { detail: "n", info: "Skip the first n documents." },
  $unwind: {
    detail: "$path",
    info: "Emit one document per element of the array field.",
  },
  $lookup: {
    detail: "{from, localField, …}",
    info: "Left-outer join against another collection.",
  },
  $count: {
    detail: '"name"',
    info: "Replace the pipeline with a single doc of the given key = count.",
  },
  $addFields: {
    detail: "{spec}",
    info: "Append computed fields to each document.",
  },
  $replaceRoot: {
    detail: "{newRoot}",
    info: "Replace the document with the given subdocument.",
  },
  $facet: {
    detail: "{name: [stages]}",
    info: "Run multiple sub-pipelines in parallel.",
  },
  $out: {
    detail: '"coll"',
    info: "Write the pipeline output to a target collection (destructive).",
  },
  $merge: {
    detail: "{into, …}",
    info: "Upsert pipeline output into a target collection.",
  },

  // Accumulators
  $sum: { detail: "expr", info: "Sum of numeric values across the group." },
  $avg: { detail: "expr", info: "Mean of numeric values across the group." },
  $min: { detail: "expr", info: "Minimum value across the group." },
  $max: { detail: "expr", info: "Maximum value across the group." },
  $push: {
    detail: "expr",
    info: "Append each expression to an array (preserves duplicates).",
  },
  $addToSet: {
    detail: "expr",
    info: "Append each expression to an array (deduplicated).",
  },
  $first: { detail: "expr", info: "First value encountered in the group." },
  $last: { detail: "expr", info: "Last value encountered in the group." },

  // BSON type tags
  $oid: { detail: '"hex"', info: "ObjectId literal — 24-char hex string." },
  $date: {
    detail: "ISO|epoch",
    info: 'ISO-8601 date string or `{ $numberLong: "ms" }`.',
  },
  $numberLong: { detail: '"int64"', info: "64-bit signed integer literal." },
  $numberDouble: { detail: '"double"', info: "IEEE-754 double literal." },
  $numberInt: { detail: '"int32"', info: "32-bit signed integer literal." },
  $numberDecimal: { detail: '"decimal"', info: "IEEE-754 decimal128 literal." },
  $binary: { detail: "{base64, subType}", info: "Binary blob with subtype." },
  $regularExpression: {
    detail: "{pattern, options}",
    info: "BSON regex literal.",
  },
  $timestamp: {
    detail: "{t, i}",
    info: "Replication timestamp (seconds + increment).",
  },
  $minKey: {
    detail: "1",
    info: "Lower bound sentinel — sorts before any value.",
  },
  $maxKey: {
    detail: "1",
    info: "Upper bound sentinel — sorts after any value.",
  },
  $symbol: { detail: '"sym"', info: "Deprecated BSON symbol type." },
  $code: { detail: '"js"', info: "Server-side JavaScript code literal." },
};

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
    // 2026-05-15 — UX 옵션 5/6: 알려진 operator 면 시그니처(detail)와
    // 한 줄 설명(info)을 같이 surface. 누락된 토큰은 label only 로 fall
    // through 해서 popup 이 깨지지 않는다.
    const meta = OPERATOR_META[label];
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
  /** Known collection names for the active database. Sourced from the
   *  schema/document store; may be empty until the user has browsed
   *  the database in the sidebar. */
  collectionNames?: readonly string[];
}

export function createMongoshDbSource(
  opts: MongoshDbSourceOptions = {},
): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const upTo = context.state.doc.sliceString(0, context.pos);

    const methodMatch = /\bdb\.([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_]*)$/.exec(
      upTo,
    );
    if (methodMatch) {
      const prefix = methodMatch[2] ?? "";
      const from = context.pos - prefix.length;
      const options: Completion[] = MONGOSH_DB_METHODS.map((cand) => ({
        label: cand.label,
        apply: cand.label,
        type: cand.type,
        detail: cand.detail,
        info: cand.info,
      }));
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
      const dbLevel: Completion[] = MONGOSH_DB_LEVEL_METHODS.map((cand) => ({
        label: cand.label,
        apply: cand.label,
        type: cand.type,
        detail: cand.detail,
        info: cand.info,
      }));
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
              ...MONGOSH_DB_METHODS.map((cand) => ({
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
    const options: Completion[] = MONGO_ADMIN_COMMANDS.map((cand) => ({
      label: cand.label,
      apply: cand.apply,
      type: "keyword",
      detail: cand.detail,
      info: cand.info,
    }));
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
