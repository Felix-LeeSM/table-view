// Cross-paradigm Safe Mode severity parity lock (issue #1120).
//
// The 5 paradigm classifiers (generic SQL / Oracle / Mongo pipeline / Mongo
// op / Redis KV) evolved their `info`/`warn`/`danger` tiers independently,
// producing asymmetries where the same *concept* got a different tier per
// dialect. The 2026-07-02 decision (memory/product/memory.md §2) re-anchors
// parity on a single axis:
//
//   TIER = f(영향 범위 × 손실성)  — impact scope × loss, NOT syntax shape.
//
//   - read / metadata ...................................... info
//   - single row/doc, targeted columns .................... info
//   - bounded multi-row write (explicit filter) ........... warn
//   - permission change (GRANT/REVOKE, all dialects) ...... warn
//   - row-level FULL reset (unfiltered write) ............. danger
//   - table/collection-level destructive ................. danger
//
// Under this axis the headline "asymmetries" from the audit are *correct*:
// `INSERT … ON CONFLICT` (row/targeted = info) and Mongo `$merge`
// (collection-level = danger) sit in different buckets by design, and
// GRANT/REVOKE is warn everywhere (danger stays reserved for irreversible
// data destruction).
//
// KV (Redis/Valkey) confirm-gated commands (KEYS / DEL / PERSIST) are
// deliberately EXCLUDED from this table. Their `danger` tier is NOT an
// impact×loss verdict — a single-key DEL is row-targeted (warn on this
// axis) and KEYS/PERSIST are not destructive at all. It is a mirror of the
// backend `required_confirmation_key` set, reusing `danger` as the only
// confirm-dialog lever (the KV path has no warn→confirm surface). That
// backend-confirm mirroring is locked in kvQueryExecution.test.ts, which is
// the correct home for it — the axis parity table stays impact×loss-only.
//
// This table is the lock: adding a paradigm or a new destructive syntax
// means adding its row here. A drifted classifier fails the matching bucket.
import { describe, expect, it } from "vitest";
import { analyzeStatement, type Severity } from "./sql/sqlSafety";
import { analyzeOracleStatement } from "./sql/oracleSafety";
import {
  analyzeMongoOperation,
  analyzeMongoPipeline,
} from "./mongo/mongoSafety";
import { analyzeKvCommandSafety } from "@/components/query/QueryTab/kvQueryExecution";

const sql = (stmt: string): Severity => analyzeStatement(stmt).severity;
const oracle = (stmt: string): Severity =>
  analyzeOracleStatement(stmt).severity;
const kv = (cmd: string): Severity => analyzeKvCommandSafety(cmd).severity;

interface ParityCase {
  paradigm: string;
  label: string;
  actual: Severity;
}

interface ParityBucket {
  axis: string;
  tier: Severity;
  cases: ParityCase[];
}

const PARITY_TABLE: ParityBucket[] = [
  {
    axis: "read / metadata",
    tier: "info",
    cases: [
      { paradigm: "sql", label: "SELECT", actual: sql("SELECT * FROM users") },
      {
        paradigm: "mongo-pipe",
        label: "read pipeline",
        actual: analyzeMongoPipeline([{ $match: { x: 1 } }]).severity,
      },
      { paradigm: "kv", label: "GET", actual: kv("GET profile:1") },
    ],
  },
  {
    axis: "single row/doc, targeted columns",
    tier: "info",
    cases: [
      {
        paradigm: "sql",
        label: "INSERT INTO",
        actual: sql("INSERT INTO users (id) VALUES (1)"),
      },
      {
        paradigm: "sql",
        label: "INSERT … ON CONFLICT DO UPDATE (row upsert)",
        actual: sql(
          "INSERT INTO users (id, n) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET n = 'a'",
        ),
      },
      {
        paradigm: "mongo-op",
        label: "updateOne",
        actual: analyzeMongoOperation({ kind: "updateOne", filter: { _id: 1 } })
          .severity,
      },
      {
        paradigm: "mongo-op",
        label: "insertOne",
        actual: analyzeMongoOperation({ kind: "insertOne" }).severity,
      },
    ],
  },
  {
    axis: "bounded multi-row write (explicit filter)",
    tier: "warn",
    cases: [
      {
        paradigm: "sql",
        label: "UPDATE … WHERE",
        actual: sql("UPDATE users SET active = 0 WHERE id = 1"),
      },
      {
        paradigm: "sql",
        label: "DELETE … WHERE",
        actual: sql("DELETE FROM users WHERE id = 1"),
      },
      {
        paradigm: "mongo-op",
        label: "updateMany(filter)",
        actual: analyzeMongoOperation({
          kind: "updateMany",
          filter: { active: true },
          patch: { $set: { active: false } },
        }).severity,
      },
      {
        paradigm: "mongo-op",
        label: "deleteMany(filter)",
        actual: analyzeMongoOperation({
          kind: "deleteMany",
          filter: { active: false },
        }).severity,
      },
    ],
  },
  {
    axis: "permission change (parity: warn across all dialects)",
    tier: "warn",
    cases: [
      {
        paradigm: "sql",
        label: "GRANT",
        actual: sql("GRANT SELECT ON users TO bob"),
      },
      {
        paradigm: "sql",
        label: "REVOKE",
        actual: sql("REVOKE SELECT ON users FROM bob"),
      },
      {
        paradigm: "oracle",
        label: "GRANT",
        actual: oracle("GRANT DBA TO app"),
      },
      {
        paradigm: "oracle",
        label: "REVOKE",
        actual: oracle("REVOKE SELECT ON t FROM app"),
      },
    ],
  },
  {
    axis: "row-level FULL reset (unfiltered write)",
    tier: "danger",
    cases: [
      {
        paradigm: "sql",
        label: "UPDATE (no WHERE)",
        actual: sql("UPDATE users SET active = 0"),
      },
      {
        paradigm: "sql",
        label: "DELETE (no WHERE)",
        actual: sql("DELETE FROM users"),
      },
      {
        paradigm: "mongo-op",
        label: "updateMany({})",
        actual: analyzeMongoOperation({
          kind: "updateMany",
          filter: {},
          patch: {},
        }).severity,
      },
      {
        paradigm: "mongo-op",
        label: "deleteMany({})",
        actual: analyzeMongoOperation({ kind: "deleteMany", filter: {} })
          .severity,
      },
    ],
  },
  {
    axis: "table/collection-level destructive",
    tier: "danger",
    cases: [
      { paradigm: "sql", label: "DROP TABLE", actual: sql("DROP TABLE users") },
      {
        paradigm: "oracle",
        label: "DROP TABLE",
        actual: oracle("DROP TABLE accounts"),
      },
      {
        paradigm: "mongo-pipe",
        label: "$out (collection replace)",
        actual: analyzeMongoPipeline([{ $out: "snapshot" }]).severity,
      },
      {
        paradigm: "mongo-pipe",
        label: "$merge (collection upsert)",
        actual: analyzeMongoPipeline([{ $merge: { into: "snapshot" } }])
          .severity,
      },
      {
        paradigm: "mongo-op",
        label: "dropCollection",
        actual: analyzeMongoOperation({ kind: "dropCollection" }).severity,
      },
    ],
  },
];

describe("[AC-1120] Safe Mode severity parity — 영향 범위 × 손실성 axis", () => {
  for (const bucket of PARITY_TABLE) {
    for (const c of bucket.cases) {
      it(`${bucket.axis} → ${bucket.tier}: [${c.paradigm}] ${c.label}`, () => {
        expect(c.actual).toBe(bucket.tier);
      });
    }
  }
});
