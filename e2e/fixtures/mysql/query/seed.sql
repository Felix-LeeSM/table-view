-- Sprint 250 — MySQL E2E seed. Mirror of seed.sql for Phase 17 MySQL adapter.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. Pipe with `mysql --abort-source-on-error -u ...
-- db < e2e/fixtures/mysql/query/seed.sql`; the MySQL equivalent of psql's
-- `-v ON_ERROR_STOP=1`.
-- The seed must remain re-runnable so e2e containers (Phase 17) can boot
-- against a warm volume without recreating the DB on every run.
--
-- Strategy (mirrors seed.sql, but resets smoke-mutated rows):
--   * `CREATE TABLE IF NOT EXISTS ...` for schema (InnoDB + utf8mb4).
--   * `INSERT ... ON DUPLICATE KEY UPDATE` for users so reruns restore names
--     after row-edit smoke.
--   * delete/reinsert the single smoke product/order rows so reruns restore
--     DML-smoke mutations without relying on a warm volume being empty.
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

INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')
  ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com')
  ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @alice_user_id := (SELECT id FROM users WHERE email = 'alice@example.com');

DELETE FROM orders WHERE user_id = @alice_user_id AND total = 99.99;
INSERT INTO orders (user_id, total) VALUES (@alice_user_id, 99.99);

DELETE FROM products WHERE name = 'Widget';
INSERT INTO products (name, price) VALUES ('Widget', 19.99);
