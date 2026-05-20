-- Canonical SQLite E2E seed.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database file MUST exit 0. Execute with `sqlite3 <db-file> < seed.sqlite.sql`.
--
-- SQLite has no server database switch; this fixture models the single file
-- connection with the `main` namespace and keeps FK enforcement explicit.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  total NUMERIC
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price NUMERIC
);

INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
  ON CONFLICT(email) DO NOTHING;
INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')
  ON CONFLICT(email) DO NOTHING;

INSERT INTO orders (user_id, total)
  SELECT 1, 99.99
  WHERE NOT EXISTS (
    SELECT 1 FROM orders WHERE user_id = 1 AND total = 99.99
  );

INSERT INTO products (name, price)
  SELECT 'Widget', 19.99
  WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE name = 'Widget' AND price = 19.99
  );
