-- Canonical Microsoft SQL Server E2E seed.
--
-- Idempotency contract: re-running this file against an already-seeded
-- database MUST exit 0. Execute with sqlcmd against the target database.
--
-- SQL Server keeps a real schema layer; the baseline tables live in `dbo`
-- to mirror PostgreSQL's `public` fixture shape.

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.users (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    email NVARCHAR(255) NULL UNIQUE
  );
END;
GO

IF OBJECT_ID(N'dbo.orders', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.orders (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    user_id BIGINT NULL,
    total DECIMAL(10, 2) NULL,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES dbo.users(id)
  );
END;
GO

IF OBJECT_ID(N'dbo.products', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.products (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    name NVARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NULL
  );
END;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = N'alice@example.com')
  INSERT INTO dbo.users (name, email) VALUES (N'Alice', N'alice@example.com');
IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE email = N'bob@example.com')
  INSERT INTO dbo.users (name, email) VALUES (N'Bob', N'bob@example.com');

IF NOT EXISTS (SELECT 1 FROM dbo.orders WHERE user_id = 1 AND total = 99.99)
  INSERT INTO dbo.orders (user_id, total) VALUES (1, 99.99);

IF NOT EXISTS (SELECT 1 FROM dbo.products WHERE name = N'Widget' AND price = 19.99)
  INSERT INTO dbo.products (name, price) VALUES (N'Widget', 19.99);
GO
