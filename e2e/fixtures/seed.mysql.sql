-- Sprint 250 — MySQL E2E seed. Mirror of seed.sql for Phase 17 MySQL adapter.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. Pipe with `mysql --abort-source-on-error -u ...
-- db < seed.mysql.sql`; the MySQL equivalent of psql's `-v ON_ERROR_STOP=1`.
-- The seed must remain re-runnable so e2e containers (Phase 17) can boot
-- against a warm volume without recreating the DB on every run.
--
-- Strategy (mirrors seed.sql):
--   * `CREATE TABLE IF NOT EXISTS ...` for schema (InnoDB + utf8mb4).
--   * `INSERT IGNORE INTO users` — UNIQUE(email) guards duplicates.
--   * `INSERT ... SELECT ... FROM DUAL WHERE NOT EXISTS (...)` guarded
--     inserts for orders/products (no UNIQUE besides AUTO_INCREMENT id).
--
-- Engine: InnoDB explicit (FK enforcement; MyISAM silently drops them).
-- Charset: utf8mb4 explicit (default still latin1 on legacy installs).

CREATE TABLE IF NOT EXISTS users (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT,
  total DECIMAL(10, 2),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO users (name, email) VALUES ('Alice', 'alice@example.com');
INSERT IGNORE INTO users (name, email) VALUES ('Bob', 'bob@example.com');

INSERT INTO orders (user_id, total)
  SELECT 1, 99.99 FROM DUAL
  WHERE NOT EXISTS (
    SELECT 1 FROM orders WHERE user_id = 1 AND total = 99.99
  );

INSERT INTO products (name, price)
  SELECT 'Widget', 19.99 FROM DUAL
  WHERE NOT EXISTS (
    SELECT 1 FROM products WHERE name = 'Widget' AND price = 19.99
  );
