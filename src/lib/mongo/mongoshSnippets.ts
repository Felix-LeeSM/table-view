// Sprint 310 (2026-05-14) — Phase 28 Slice A4: 4-section snippet dictionary
// for the toolbar `+ Insert ▾` popover.
//
// Sections (ordered): Query methods (6) / Mutation methods (7) / Operators
// (13, Q7 order) / Stages (≥14 core).
//
// Single-source-of-truth invariants:
// - Method labels are partitioned from `MONGOSH_METHOD_WHITELIST` (parser
//   surface, Sprint 307 A1). Adding a method to the whitelist surfaces it
//   here only when this file also partitions it into Query vs Mutation —
//   the partition is the deliberate UX classification, not pure derivation.
// - Operators and Stages are referenced from `MONGO_QUERY_OPERATORS` /
//   `MONGO_AGGREGATE_STAGES` (Sprint 304 autocomplete surface). The
//   operator list is filtered to the contract's 13-member Q7 set.
//
// Placeholder convention (decision D-06): templates use `<placeholder>`
// markers that the snippet engine converts to CodeMirror's `${name}` at
// insertion time. Operator/Stage snippets are *wrapped fragments*
// (`{ $gt: <value> }`) per D-08 so the user gets a paste-and-go fragment.

import { MONGOSH_METHOD_WHITELIST } from "@/lib/mongo/mongoshParser";

/**
 * Single snippet entry rendered as one button inside a popover section.
 * `description` is shown as a small caption / aria description when
 * provided.
 */
export interface MongoshSnippet {
  /** User-visible label (also the matching method/operator name). */
  readonly label: string;
  /** Template with `<placeholder>` markers. Engine converts to CM snippet. */
  readonly insertText: string;
  /** Optional one-line caption surfaced to assistive tech / tooltip. */
  readonly description?: string;
}

/** Popover section bundle. */
export interface MongoshSnippetSection {
  readonly label: string;
  readonly entries: readonly MongoshSnippet[];
}

// --- Methods --------------------------------------------------------------
//
// The whitelist is the authority. Partition it explicitly so that adding
// a method to the whitelist forces a code change here (forcing the
// classifier into Query vs Mutation — these are not interchangeable for
// UX dispatch).

const QUERY_METHOD_NAMES = [
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
] as const satisfies readonly (typeof MONGOSH_METHOD_WHITELIST)[number][];

const MUTATION_METHOD_NAMES = [
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "bulkWrite",
] as const satisfies readonly (typeof MONGOSH_METHOD_WHITELIST)[number][];

const METHOD_TEMPLATES: Readonly<
  Record<(typeof MONGOSH_METHOD_WHITELIST)[number], string>
> = {
  find: "db.<collection>.find(<filter>).limit(<n>)",
  findOne: "db.<collection>.findOne(<filter>)",
  aggregate: "db.<collection>.aggregate([<stage>])",
  countDocuments: "db.<collection>.countDocuments(<filter>)",
  estimatedDocumentCount: "db.<collection>.estimatedDocumentCount()",
  distinct: "db.<collection>.distinct(<field>, <filter>)",
  insertOne: "db.<collection>.insertOne(<document>)",
  insertMany: "db.<collection>.insertMany([<document>])",
  updateOne: "db.<collection>.updateOne(<filter>, { $set: <update> })",
  updateMany: "db.<collection>.updateMany(<filter>, { $set: <update> })",
  deleteOne: "db.<collection>.deleteOne(<filter>)",
  deleteMany: "db.<collection>.deleteMany(<filter>)",
  bulkWrite: "db.<collection>.bulkWrite([<ops>])",
};

const METHOD_DESCRIPTIONS: Readonly<
  Record<(typeof MONGOSH_METHOD_WHITELIST)[number], string>
> = {
  find: "Return documents matching a filter.",
  findOne: "Return a single document matching a filter.",
  aggregate: "Run an aggregation pipeline.",
  countDocuments: "Return the count of documents matching a filter.",
  estimatedDocumentCount: "Return the collection's estimated document count.",
  distinct: "Return distinct values for a field.",
  insertOne: "Insert a single document.",
  insertMany: "Insert multiple documents.",
  updateOne: "Update a single document matching a filter.",
  updateMany: "Update multiple documents matching a filter.",
  deleteOne: "Delete a single document matching a filter.",
  deleteMany: "Delete multiple documents matching a filter.",
  bulkWrite: "Run a list of write operations in one call.",
};

function buildMethodSnippet(
  name: (typeof MONGOSH_METHOD_WHITELIST)[number],
): MongoshSnippet {
  return {
    label: name,
    insertText: METHOD_TEMPLATES[name],
    description: METHOD_DESCRIPTIONS[name],
  };
}

export const MONGOSH_QUERY_METHOD_SNIPPETS: readonly MongoshSnippet[] =
  QUERY_METHOD_NAMES.map(buildMethodSnippet);

export const MONGOSH_MUTATION_METHOD_SNIPPETS: readonly MongoshSnippet[] =
  MUTATION_METHOD_NAMES.map(buildMethodSnippet);

// --- Operators (Q7 order) -------------------------------------------------
//
// Contract sprint-310 §AC-03 fixes the 13-operator order. The full
// `MONGO_QUERY_OPERATORS` constant (Sprint 304) has 18 entries — the
// snippet menu is intentionally a subset (Q7 set: high-frequency filter
// operators). The order matters because the popover renders entries
// vertically and AC-03 asserts the exact list.

const OPERATOR_NAMES = [
  "$eq",
  "$ne",
  "$gt",
  "$gte",
  "$lt",
  "$lte",
  "$in",
  "$nin",
  "$exists",
  "$regex",
  "$or",
  "$and",
  "$not",
] as const;

const OPERATOR_TEMPLATES: Readonly<
  Record<(typeof OPERATOR_NAMES)[number], string>
> = {
  $eq: "{ $eq: <value> }",
  $ne: "{ $ne: <value> }",
  $gt: "{ $gt: <value> }",
  $gte: "{ $gte: <value> }",
  $lt: "{ $lt: <value> }",
  $lte: "{ $lte: <value> }",
  $in: "{ $in: [<value>] }",
  $nin: "{ $nin: [<value>] }",
  $exists: "{ $exists: <bool> }",
  $regex: "{ $regex: <pattern> }",
  $or: "{ $or: [<expr>] }",
  $and: "{ $and: [<expr>] }",
  $not: "{ $not: <expr> }",
};

export const MONGOSH_OPERATOR_SNIPPETS: readonly MongoshSnippet[] =
  OPERATOR_NAMES.map((name) => ({
    label: name,
    insertText: OPERATOR_TEMPLATES[name],
  }));

// --- Stages ---------------------------------------------------------------
//
// Spec sprint-307 §A4-3 lists 14 core stages. We mirror that order, all
// referenced against `MONGO_AGGREGATE_STAGES` (Sprint 304 autocomplete).

const STAGE_NAMES = [
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

const STAGE_TEMPLATES: Readonly<Record<(typeof STAGE_NAMES)[number], string>> =
  {
    $match: "{ $match: <expr> }",
    $project: "{ $project: <expr> }",
    $group: "{ $group: { _id: <key>, <field>: { $sum: <value> } } }",
    $sort: "{ $sort: { <field>: <order> } }",
    $limit: "{ $limit: <n> }",
    $skip: "{ $skip: <n> }",
    $unwind: "{ $unwind: <path> }",
    $lookup:
      "{ $lookup: { from: <foreign>, localField: <local>, foreignField: <foreign_field>, as: <as> } }",
    $count: "{ $count: <field> }",
    $addFields: "{ $addFields: <expr> }",
    $replaceRoot: "{ $replaceRoot: { newRoot: <expr> } }",
    $facet: "{ $facet: <expr> }",
    $out: "{ $out: <collection> }",
    $merge: "{ $merge: { into: <collection> } }",
  };

export const MONGOSH_STAGE_SNIPPETS: readonly MongoshSnippet[] =
  STAGE_NAMES.map((name) => ({
    label: name,
    insertText: STAGE_TEMPLATES[name],
  }));

// --- Aggregate ------------------------------------------------------------

export const ALL_MONGOSH_SNIPPETS: readonly MongoshSnippetSection[] = [
  { label: "Query methods", entries: MONGOSH_QUERY_METHOD_SNIPPETS },
  { label: "Mutation methods", entries: MONGOSH_MUTATION_METHOD_SNIPPETS },
  { label: "Operators", entries: MONGOSH_OPERATOR_SNIPPETS },
  { label: "Stages", entries: MONGOSH_STAGE_SNIPPETS },
];
