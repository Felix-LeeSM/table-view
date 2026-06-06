import type { DatabaseType } from "./connection";

export const RDBMS_DATABASE_TYPES = Object.freeze([
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "duckdb",
  "mssql",
  "oracle",
] as const satisfies readonly DatabaseType[]);

export const RUNTIME_RDBMS_DATABASE_TYPES = Object.freeze([
  "postgresql",
  "mysql",
  "mariadb",
  "sqlite",
  "duckdb",
  "mssql",
] as const satisfies readonly DatabaseType[]);

export type RuntimeRdbmsDatabaseType =
  (typeof RUNTIME_RDBMS_DATABASE_TYPES)[number];

export const SERVER_RDBMS_DATABASE_TYPES = Object.freeze([
  "postgresql",
  "mysql",
  "mariadb",
  "mssql",
] as const satisfies readonly DatabaseType[]);

export const FILE_RDBMS_DATABASE_TYPES = Object.freeze([
  "sqlite",
  "duckdb",
] as const satisfies readonly DatabaseType[]);
