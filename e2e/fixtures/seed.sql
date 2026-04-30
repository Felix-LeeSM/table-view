-- sprint-169 / Sprint 3 — canonical E2E Postgres seed.
--
-- Single source of truth for the E2E suite's Postgres fixture data. Replaces
-- the duplicated heredoc in `e2e/run-e2e-docker.sh` and `.github/workflows/ci.yml`.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. The `psql -v ON_ERROR_STOP=1 -f` invocation in
-- `e2e/run-e2e-docker.sh` will fail the container otherwise, masking real
-- test failures behind seed errors.
--
-- Strategy:
--   * `CREATE TABLE IF NOT EXISTS ...` for schema.
--   * `INSERT ... ON CONFLICT (email) DO NOTHING` for `users` (unique column).
--   * `INSERT ... SELECT ... WHERE NOT EXISTS (...)` guarded inserts for
--     `orders` and `products` (no unique column besides the SERIAL id).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE
);

CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  total DECIMAL(10, 2)
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2)
);

INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
  ON CONFLICT (email) DO NOTHING;
INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')
  ON CONFLICT (email) DO NOTHING;

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
