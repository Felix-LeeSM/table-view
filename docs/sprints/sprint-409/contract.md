# sprint-409 — public wire camelCase migration

## Scope

Move the remaining public query, document, and connection wire payloads to
camelCase while preserving legacy snake_case restore/import compatibility at
explicit boundaries.

## Acceptance Criteria

- AC-409-01: Rust public wire models serialize camelCase keys for
  `QueryColumn`, `QueryResult`, `DocumentId`, `DocumentQueryResult`,
  `DocumentRow`, and `ConnectionConfigPublic`.
- AC-409-02: frontend canonical types use camelCase for query result,
  document result, document id, and connection config fields.
- AC-409-03: Tauri wrappers and snapshot/session hydration normalize legacy
  snake_case payloads before data enters stores or UI renderers.
- AC-409-04: document query cache hits normalize legacy snake_case payloads
  before storing or rendering.
- AC-409-05: `ConnectionConfigPublic` still deserializes legacy snake_case
  export/import payloads while emitting camelCase on new exports.
- AC-409-06: schema/table-data fields that are intentionally snake_case
  (`ColumnInfo.data_type`, `TableData.total_count`, database SQL column names)
  remain unchanged.
- AC-409-07: the known flake loops stay green before delivery.

## Explicit Non-Goals

- Do not change `QueryType` nested DML payload:
  `{ dml: { rows_affected } }` remains snake_case to match the existing Rust
  enum tag contract.
- Do not migrate schema/table-data models such as `ColumnInfo`, `TableData`,
  `CollectionInfo.document_count`, or storage SQL column names.
- Do not migrate `BulkWriteResult` counter fields; they remain snake_case.
- Do not introduce a workspace persistence schema version in this sprint.
