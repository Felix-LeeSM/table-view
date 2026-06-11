-- Canonical DuckDB E2E seed.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. Execute with
-- `duckdb <db-file> < e2e/fixtures/duckdb/query/seed.sql`.
--
-- DuckDB uses PG-compatible SQL. The baseline tables live in named schemas
-- to mirror PostgreSQL's fixture shape (core, catalog, sales, support).

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS sales;
CREATE SCHEMA IF NOT EXISTS support;

CREATE TABLE IF NOT EXISTS core.users (
  id INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  email VARCHAR UNIQUE
);

CREATE TABLE IF NOT EXISTS core.orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES core.users(id),
  total DECIMAL(10, 2)
);

CREATE TABLE IF NOT EXISTS core.products (
  id INTEGER PRIMARY KEY,
  name VARCHAR NOT NULL,
  price DECIMAL(10, 2)
);

INSERT INTO core.users (id, name, email) VALUES (1, 'Alice', 'alice@example.com')
  ON CONFLICT (email) DO NOTHING;
INSERT INTO core.users (id, name, email) VALUES (2, 'Bob', 'bob@example.com')
  ON CONFLICT (email) DO NOTHING;

INSERT INTO core.orders (id, user_id, total)
  SELECT 1, 1, 99.99
  WHERE NOT EXISTS (
    SELECT 1 FROM core.orders WHERE user_id = 1 AND total = 99.99
  );

INSERT INTO core.products (id, name, price)
  SELECT 1, 'Widget', 19.99
  WHERE NOT EXISTS (
    SELECT 1 FROM core.products WHERE name = 'Widget' AND price = 19.99
  );
