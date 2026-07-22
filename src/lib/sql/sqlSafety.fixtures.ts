import type { StatementAnalysis } from "./sqlSafety";

export type SqlSafetyExpectedCase = { sql: string } & StatementAnalysis;

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

export const mssqlUnsupportedScriptingSql = [
  "CREATE PROCEDURE dbo.refresh_users AS BEGIN SELECT 1; END",
  "ALTER PROCEDURE dbo.refresh_users AS BEGIN SELECT 1; END",
  "CREATE OR ALTER PROCEDURE dbo.refresh_users AS BEGIN SELECT 1; END",
  "BEGIN SELECT 1; END",
  "DECLARE @id int = 1",
  "BEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT ERROR_MESSAGE(); END CATCH",
  "WHILE 1 = 0 BEGIN SELECT 1; END",
] as const;
