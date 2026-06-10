import type { DatabaseType } from "./connection";

export type AdapterContractTestArea =
  | "query"
  | "result"
  | "catalog"
  | "explain"
  | "completion"
  | "safety";

export type AdapterContractTestJudgement =
  | "common"
  | "dbms-delta"
  | "unsupported-delta"
  | "deferred";

export type AdapterContractDeltaAxis =
  | "dbms"
  | "version"
  | "dialect"
  | "paradigm"
  | "capability"
  | "evidence";

export type AdapterContractChildIssue = 765 | 766 | 767 | 768;

export interface AdapterContractCommonExpectation {
  readonly id: string;
  readonly judgement: Extract<AdapterContractTestJudgement, "common">;
  readonly assertion: string;
}

export interface AdapterContractDeltaTemplate {
  readonly id: string;
  readonly judgement: Exclude<AdapterContractTestJudgement, "common">;
  readonly axes: readonly AdapterContractDeltaAxis[];
  readonly dbTypes: readonly DatabaseType[];
  readonly assertion: string;
  readonly evidenceRule: string;
}

export interface AdapterContractTestMatrixRow {
  readonly area: AdapterContractTestArea;
  readonly childIssue: AdapterContractChildIssue;
  readonly common: readonly AdapterContractCommonExpectation[];
  readonly deltaTemplates: readonly AdapterContractDeltaTemplate[];
}

const RDB_DATABASE_TYPES = Object.freeze([
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "duckdb",
  "mssql",
  "oracle",
] as const satisfies readonly DatabaseType[]);

const DOCUMENT_DATABASE_TYPES = Object.freeze([
  "mongodb",
] as const satisfies readonly DatabaseType[]);

const KV_DATABASE_TYPES = Object.freeze([
  "redis",
  "valkey",
] as const satisfies readonly DatabaseType[]);

const SEARCH_DATABASE_TYPES = Object.freeze([
  "elasticsearch",
  "opensearch",
] as const satisfies readonly DatabaseType[]);

export const ADAPTER_CONTRACT_TEST_DATABASE_TYPES = Object.freeze([
  ...RDB_DATABASE_TYPES,
  ...DOCUMENT_DATABASE_TYPES,
  ...KV_DATABASE_TYPES,
  ...SEARCH_DATABASE_TYPES,
] as const satisfies readonly DatabaseType[]);

export const ADAPTER_CONTRACT_TEST_MATRIX = Object.freeze([
  contractRow({
    area: "query",
    childIssue: 765,
    common: [
      commonExpectation(
        "query.dispatch-success",
        "Supported query execution returns a typed response without changing command routing.",
      ),
      commonExpectation(
        "query.error-envelope",
        "Parser, adapter, cancellation, and unsupported failures keep typed AppError boundaries.",
      ),
    ],
    deltaTemplates: [
      deltaTemplate({
        id: "query.rdb-dialect",
        judgement: "dbms-delta",
        axes: ["dbms", "dialect", "version"],
        dbTypes: RDB_DATABASE_TYPES,
        assertion:
          "RDB query tests record dialect, multi-statement, cancellation, and version-sensitive SQL behavior as DBMS deltas.",
        evidenceRule:
          "Fixture-only SQL evidence does not promote runtime support beyond existing smoke-backed claims.",
      }),
      deltaTemplate({
        id: "query.document-kv-search",
        judgement: "dbms-delta",
        axes: ["paradigm", "capability"],
        dbTypes: [
          ...DOCUMENT_DATABASE_TYPES,
          ...KV_DATABASE_TYPES,
          ...SEARCH_DATABASE_TYPES,
        ],
        assertion:
          "Document, KV, and Search query tests keep native command/DSL semantics instead of normalizing to SQL.",
        evidenceRule:
          "Native query evidence must name the product/paradigm path it covers.",
      }),
    ],
  }),
  contractRow({
    area: "result",
    childIssue: 765,
    common: [
      commonExpectation(
        "result.envelope-kind",
        "Every adapter contract test asserts one declared result envelope kind.",
      ),
      commonExpectation(
        "result.empty-success",
        "Empty success, mutation acknowledgement, and unsupported errors remain distinct outcomes.",
      ),
    ],
    deltaTemplates: [
      deltaTemplate({
        id: "result.rdb-tabular",
        judgement: "dbms-delta",
        axes: ["dbms", "dialect"],
        dbTypes: RDB_DATABASE_TYPES,
        assertion:
          "RDB result tests keep tabular columns, rows, affected counts, and batch outcomes explicit per dialect.",
        evidenceRule:
          "Tabular fixture coverage does not imply non-tabular renderer coverage.",
      }),
      deltaTemplate({
        id: "result.native-envelope",
        judgement: "dbms-delta",
        axes: ["paradigm", "capability"],
        dbTypes: [
          ...DOCUMENT_DATABASE_TYPES,
          ...KV_DATABASE_TYPES,
          ...SEARCH_DATABASE_TYPES,
        ],
        assertion:
          "Document, KV, and Search result tests use document, keyValue/streamRecords, or searchHits envelopes as declared.",
        evidenceRule:
          "Native envelope evidence must stay separate from QueryResultGrid tabular fallback evidence.",
      }),
    ],
  }),
  contractRow({
    area: "catalog",
    childIssue: 766,
    common: [
      commonExpectation(
        "catalog.model-kind",
        "Catalog tests assert the declared catalog model before adapter-specific metadata.",
      ),
      commonExpectation(
        "catalog.permission-fallback",
        "Permission gaps and unavailable metadata stay explicit instead of becoming empty success.",
      ),
    ],
    deltaTemplates: [
      deltaTemplate({
        id: "catalog.rdb-versioned-metadata",
        judgement: "dbms-delta",
        axes: ["dbms", "version", "dialect"],
        dbTypes: RDB_DATABASE_TYPES,
        assertion:
          "RDB catalog tests keep schema/table/view/column/index/constraint/FK deltas version-aware.",
        evidenceRule:
          "Catalog metadata evidence does not promote admin/workbench parity by itself.",
      }),
      deltaTemplate({
        id: "catalog.native-models",
        judgement: "dbms-delta",
        axes: ["paradigm", "capability"],
        dbTypes: [
          ...DOCUMENT_DATABASE_TYPES,
          ...KV_DATABASE_TYPES,
          ...SEARCH_DATABASE_TYPES,
        ],
        assertion:
          "Document, KV, and Search catalog tests keep collection/index, key/type/TTL, and index/mapping/template models native.",
        evidenceRule:
          "Fixture inventory remains contract evidence unless a matching live/runtime path is wired.",
      }),
    ],
  }),
  contractRow({
    area: "explain",
    childIssue: 766,
    common: [
      commonExpectation(
        "explain.capability-gate",
        "Explain tests assert supported explain paths and unsupported explain boundaries separately.",
      ),
      commonExpectation(
        "explain.no-mutation",
        "Explain tests never execute a destructive query as proof of a plan path.",
      ),
    ],
    deltaTemplates: [
      deltaTemplate({
        id: "explain.rdb-plan",
        judgement: "dbms-delta",
        axes: ["dbms", "dialect", "capability"],
        dbTypes: RDB_DATABASE_TYPES,
        assertion:
          "RDB explain tests keep JSON/text plan shape, dry-run policy, and unsupported dialects explicit.",
        evidenceRule:
          "Postgres explain evidence does not promote MySQL-family, MSSQL, Oracle, SQLite, or DuckDB explain support.",
      }),
      deltaTemplate({
        id: "explain.native-plan",
        judgement: "unsupported-delta",
        axes: ["paradigm", "capability"],
        dbTypes: [
          ...DOCUMENT_DATABASE_TYPES,
          ...KV_DATABASE_TYPES,
          ...SEARCH_DATABASE_TYPES,
        ],
        assertion:
          "Document/Search explain payloads and KV unsupported explain behavior stay separate deltas.",
        evidenceRule:
          "Explain payload rendering evidence does not widen query execution claims.",
      }),
    ],
  }),
  contractRow({
    area: "completion",
    childIssue: 767,
    common: [
      commonExpectation(
        "completion.request-compat",
        "Completion metadata tests assert TS request wrappers remain compatible with Rust/WASM owners.",
      ),
      commonExpectation(
        "completion.no-vocabulary-widening",
        "Completion metadata evidence does not widen editor suggestion vocabulary without detected capability proof.",
      ),
    ],
    deltaTemplates: [
      deltaTemplate({
        id: "completion.sql-dialect",
        judgement: "dbms-delta",
        axes: ["dbms", "dialect", "version"],
        dbTypes: RDB_DATABASE_TYPES,
        assertion:
          "SQL completion metadata tests keep dialect, catalog scope, routine/extension, and version deltas explicit.",
        evidenceRule:
          "Completion-context evidence is editor assistance only, not runtime query support.",
      }),
      deltaTemplate({
        id: "completion.native-language",
        judgement: "dbms-delta",
        axes: ["paradigm", "capability"],
        dbTypes: [
          ...DOCUMENT_DATABASE_TYPES,
          ...KV_DATABASE_TYPES,
          ...SEARCH_DATABASE_TYPES,
        ],
        assertion:
          "Mongosh, Redis command, and Search DSL completion tests keep native language ownership explicit.",
        evidenceRule:
          "Provider packs and product-specific suggestions require detected capability evidence.",
      }),
    ],
  }),
  contractRow({
    area: "safety",
    childIssue: 768,
    common: [
      commonExpectation(
        "safety.policy-envelope",
        "Safety tests assert destructive, expensive, privacy-sensitive, and unsupported paths through explicit policies.",
      ),
      commonExpectation(
        "safety.planned-identity",
        "Planned or declared identities remain non-claims until runtime capabilities are proven.",
      ),
    ],
    deltaTemplates: [
      deltaTemplate({
        id: "safety.rdb-destructive",
        judgement: "unsupported-delta",
        axes: ["dbms", "dialect", "capability"],
        dbTypes: RDB_DATABASE_TYPES,
        assertion:
          "RDB safety tests keep Safe Mode, schema mutation, and unsupported scripting deltas per dialect.",
        evidenceRule:
          "DDL/edit evidence must name whether it is preview-only, fixture, integration, or smoke-backed.",
      }),
      deltaTemplate({
        id: "safety.native-unsupported",
        judgement: "unsupported-delta",
        axes: ["paradigm", "capability", "evidence"],
        dbTypes: [
          ...DOCUMENT_DATABASE_TYPES,
          ...KV_DATABASE_TYPES,
          ...SEARCH_DATABASE_TYPES,
        ],
        assertion:
          "Document, KV, and Search safety tests keep runCommand, key mutation, and delete-by-query unsupported boundaries explicit.",
        evidenceRule:
          "Unsupported-boundary evidence must not soften confirmations or promote fixture-only support.",
      }),
    ],
  }),
] as const satisfies readonly AdapterContractTestMatrixRow[]);

function contractRow(
  row: AdapterContractTestMatrixRow,
): AdapterContractTestMatrixRow {
  Object.freeze(row.common);
  Object.freeze(row.deltaTemplates);
  return Object.freeze(row);
}

function commonExpectation(
  id: string,
  assertion: string,
): AdapterContractCommonExpectation {
  return Object.freeze({
    id,
    judgement: "common",
    assertion,
  });
}

function deltaTemplate(
  template: AdapterContractDeltaTemplate,
): AdapterContractDeltaTemplate {
  Object.freeze(template.axes);
  Object.freeze(template.dbTypes);
  return Object.freeze(template);
}
