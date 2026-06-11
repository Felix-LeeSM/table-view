import type { StatementAnalysis } from "./sqlSafety";

export type SqlSafetyExpectedCase = { sql: string } & StatementAnalysis;

export const ddlAdditiveShapeSql = [
  "CREATE TABLE t (a INTEGER)",
  "CREATE INDEX idx ON t (a)",
  "CREATE VIEW v AS SELECT a FROM t",
  "ALTER TABLE t ADD COLUMN c TEXT",
  "ALTER TABLE t ADD CONSTRAINT pk PRIMARY KEY (id)",
  "ALTER TABLE t RENAME TO t2",
  "ALTER TABLE t RENAME COLUMN a TO b",
] as const;

export const miscGrammarShapeSql = [
  "GRANT SELECT ON users TO alice",
  "REVOKE SELECT ON users FROM alice",
  "EXPLAIN SELECT * FROM users",
  "SHOW search_path",
  "SET timezone = 'UTC'",
  "COPY users FROM '/tmp/u.csv'",
  "COMMENT ON TABLE users IS 'all'",
] as const;

export const mssqlDestructiveDdlSql = [
  "DROP TABLE [dbo].[users]",
  "TRUNCATE TABLE [dbo].[users]",
  "ALTER TABLE [dbo].[users] DROP COLUMN [email]",
] as const;

export const mssqlScriptingBoundaryCases = [
  {
    sql: "EXEC dbo.refresh_users",
    kind: "routine-call",
    severity: "warn",
    reasons: ["EXEC — stored routine execution"],
  },
  {
    sql: "GO",
    kind: "other",
    severity: "warn",
    reasons: ["GO — T-SQL batch separator unsupported"],
  },
  {
    sql: "USE [app]",
    kind: "config-write",
    severity: "warn",
    reasons: ["USE — database context switch unsupported"],
  },
  {
    sql: "DBCC CHECKDB ([app])",
    kind: "other",
    severity: "warn",
    reasons: ["DBCC — SQL Server admin command unsupported"],
  },
  {
    sql: "DENY SELECT ON users TO alice",
    kind: "permission-change",
    severity: "warn",
    reasons: ["DENY — 권한 변경"],
  },
  {
    sql: "BACKUP DATABASE [app] TO DISK = N'/tmp/app.bak'",
    kind: "data-movement",
    severity: "warn",
    reasons: ["BACKUP — SQL Server backup unsupported"],
  },
  {
    sql: "RESTORE DATABASE [app] FROM DISK = N'/tmp/app.bak'",
    kind: "data-movement",
    severity: "danger",
    reasons: ["RESTORE — SQL Server restore may overwrite database"],
  },
] satisfies ReadonlyArray<SqlSafetyExpectedCase>;

export const mssqlBatchSeparatorSql = [
  "SELECT 1\nGO\nDROP TABLE [dbo].[users]",
  "SELECT 1\nGO\nRESTORE DATABASE [app] FROM DISK = N'/tmp/app.bak'",
  "SELECT 1\nGO 2\nDROP TABLE [dbo].[users]",
] as const;
