-- Canonical MariaDB E2E seed.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. Execute with the MariaDB/MySQL client using
-- `--abort-source-on-error`.
--
-- MariaDB shares the MySQL protocol adapter, but the fixture stays separate
-- so feature slices can add MariaDB-specific DDL or type cases without
-- changing the MySQL baseline. Re-runs also restore smoke-mutated rows so a
-- warm volume starts from deterministic evidence.

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
