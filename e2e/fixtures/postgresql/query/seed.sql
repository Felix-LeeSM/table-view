-- sprint-297 — canonical E2E smoke Postgres seed.
--
-- Single source of truth for the smoke suite's Postgres fixture data.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. `e2e/fixtures/seed-smoke.ts` retries startup but should
-- not mask seed errors behind duplicate-key failures.
--
-- Strategy:
--   * `CREATE EXTENSION IF NOT EXISTS ...` for installed-extension completion.
--   * `CREATE TABLE IF NOT EXISTS ...` for schema.
--   * `INSERT ... ON CONFLICT (email) DO NOTHING` for `users` (unique column).
--   * `INSERT ... SELECT ... WHERE NOT EXISTS (...)` guarded inserts for
--     `orders` and `products` (no unique column besides the SERIAL id).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

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

CREATE TABLE IF NOT EXISTS erd_regions (
  id INTEGER PRIMARY KEY,
  code VARCHAR(16) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS erd_customers (
  id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES erd_regions(id),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS erd_addresses (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES erd_customers(id),
  region_id INTEGER NOT NULL REFERENCES erd_regions(id),
  line1 VARCHAR(255) NOT NULL,
  city VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS erd_products (
  id INTEGER PRIMARY KEY,
  region_id INTEGER NOT NULL REFERENCES erd_regions(id),
  sku VARCHAR(64) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS erd_orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES erd_customers(id),
  billing_address_id INTEGER NOT NULL REFERENCES erd_addresses(id),
  shipping_address_id INTEGER NOT NULL REFERENCES erd_addresses(id),
  status VARCHAR(24) NOT NULL CHECK (status IN ('draft', 'paid', 'shipped'))
);

CREATE TABLE IF NOT EXISTS erd_order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES erd_orders(id),
  product_id INTEGER NOT NULL REFERENCES erd_products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS erd_shipments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES erd_orders(id),
  address_id INTEGER NOT NULL REFERENCES erd_addresses(id),
  tracking_code VARCHAR(64) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS erd_payments (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES erd_orders(id),
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  provider VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS erd_refunds (
  id INTEGER PRIMARY KEY,
  payment_id INTEGER NOT NULL REFERENCES erd_payments(id),
  order_item_id INTEGER NOT NULL REFERENCES erd_order_items(id),
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS idx_erd_customers_region
  ON erd_customers(region_id);
CREATE INDEX IF NOT EXISTS idx_erd_addresses_customer_region
  ON erd_addresses(customer_id, region_id);
CREATE INDEX IF NOT EXISTS idx_erd_products_region
  ON erd_products(region_id);
CREATE INDEX IF NOT EXISTS idx_erd_orders_customer
  ON erd_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_erd_order_items_order_product
  ON erd_order_items(order_id, product_id);
CREATE INDEX IF NOT EXISTS idx_erd_shipments_order
  ON erd_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_erd_payments_order
  ON erd_payments(order_id);
CREATE INDEX IF NOT EXISTS idx_erd_refunds_payment_item
  ON erd_refunds(payment_id, order_item_id);

INSERT INTO erd_regions (id, code, name) VALUES
  (1, 'NA', 'North America'),
  (2, 'EU', 'Europe')
ON CONFLICT (id) DO UPDATE
  SET code = EXCLUDED.code,
      name = EXCLUDED.name;

INSERT INTO erd_customers (id, region_id, name, email) VALUES
  (1, 1, 'Erd Alice', 'erd.alice@example.com'),
  (2, 2, 'Erd Bob', 'erd.bob@example.com')
ON CONFLICT (id) DO UPDATE
  SET region_id = EXCLUDED.region_id,
      name = EXCLUDED.name,
      email = EXCLUDED.email;

INSERT INTO erd_addresses (id, customer_id, region_id, line1, city) VALUES
  (1, 1, 1, '1 Graph Way', 'Boston'),
  (2, 1, 1, '2 Layout Ave', 'Austin'),
  (3, 2, 2, '3 Metadata St', 'Berlin')
ON CONFLICT (id) DO UPDATE
  SET customer_id = EXCLUDED.customer_id,
      region_id = EXCLUDED.region_id,
      line1 = EXCLUDED.line1,
      city = EXCLUDED.city;

INSERT INTO erd_products (id, region_id, sku, name, price) VALUES
  (1, 1, 'ERD-WIDGET', 'ERD Widget', 29.99),
  (2, 2, 'ERD-GADGET', 'ERD Gadget', 39.99)
ON CONFLICT (id) DO UPDATE
  SET region_id = EXCLUDED.region_id,
      sku = EXCLUDED.sku,
      name = EXCLUDED.name,
      price = EXCLUDED.price;

INSERT INTO erd_orders (
  id,
  customer_id,
  billing_address_id,
  shipping_address_id,
  status
) VALUES
  (1, 1, 1, 2, 'paid'),
  (2, 2, 3, 3, 'shipped')
ON CONFLICT (id) DO UPDATE
  SET customer_id = EXCLUDED.customer_id,
      billing_address_id = EXCLUDED.billing_address_id,
      shipping_address_id = EXCLUDED.shipping_address_id,
      status = EXCLUDED.status;

INSERT INTO erd_order_items (id, order_id, product_id, quantity, unit_price)
VALUES
  (1, 1, 1, 2, 29.99),
  (2, 1, 2, 1, 39.99),
  (3, 2, 2, 3, 39.99)
ON CONFLICT (id) DO UPDATE
  SET order_id = EXCLUDED.order_id,
      product_id = EXCLUDED.product_id,
      quantity = EXCLUDED.quantity,
      unit_price = EXCLUDED.unit_price;

INSERT INTO erd_shipments (id, order_id, address_id, tracking_code) VALUES
  (1, 1, 2, 'ERD-SHIP-1'),
  (2, 2, 3, 'ERD-SHIP-2')
ON CONFLICT (id) DO UPDATE
  SET order_id = EXCLUDED.order_id,
      address_id = EXCLUDED.address_id,
      tracking_code = EXCLUDED.tracking_code;

INSERT INTO erd_payments (id, order_id, amount, provider) VALUES
  (1, 1, 99.97, 'card'),
  (2, 2, 119.97, 'bank')
ON CONFLICT (id) DO UPDATE
  SET order_id = EXCLUDED.order_id,
      amount = EXCLUDED.amount,
      provider = EXCLUDED.provider;

INSERT INTO erd_refunds (id, payment_id, order_item_id, amount) VALUES
  (1, 1, 2, 10.00)
ON CONFLICT (id) DO UPDATE
  SET payment_id = EXCLUDED.payment_id,
      order_item_id = EXCLUDED.order_item_id,
      amount = EXCLUDED.amount;
