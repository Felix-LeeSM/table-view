-- Canonical MariaDB E2E seed.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. Execute with the MariaDB/MySQL client using
-- `--abort-source-on-error`.
--
-- MariaDB shares the MySQL protocol adapter, but the fixture stays separate
-- so feature slices can add MariaDB-specific DDL or type cases without
-- changing the MySQL baseline.

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
