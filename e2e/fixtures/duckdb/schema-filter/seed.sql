-- DuckDB schema-filter regression seed.
--
-- Deterministic shape for `duckdb-schema-filter.spec.ts`:
--   - `core.users` — one real user table so the sidebar has a populated,
--     user-created schema to render.
--   - `main` — DuckDB's default schema, left INTENTIONALLY EMPTY. It is the
--     user database's own schema, so the flat tree renders exactly one
--     "No tables" placeholder for it.
--
-- Before the `list_namespaces` fix, the internal `system` and `temp` catalogs
-- each contributed their own empty `main` schema, so the flat tree rendered
-- THREE "No tables" placeholders instead of one. This fixture makes that
-- duplication countable.
--
-- Idempotent: re-running against an already-seeded DB MUST exit 0.

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.users (
  id INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR UNIQUE
);

INSERT INTO core.users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')
  ON CONFLICT (email) DO NOTHING;
