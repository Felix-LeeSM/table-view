import {
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
} from "@codemirror/lang-sql";
import type { DatabaseType } from "@/types/connection";

export type SqlDialectId =
  | "postgresql"
  | "mysql"
  | "mariadb"
  | "sqlite"
  | "duckdb"
  | "mssql"
  | "oracle"
  | "ansi";

export type SqlDialectFamily =
  | "postgres"
  | "mysql"
  | "sqlite"
  | "duckdb"
  | "mssql"
  | "oracle"
  | "ansi";

export type SqlShellId = "none" | "psql" | "mysql-client" | "sqlite-cli";

export interface SqlDialectCapabilities {
  schemas: boolean;
  returning: boolean;
  ilike: boolean;
  onConflict: boolean;
  limitOffsetComma: boolean;
  dollarQuotedStrings: boolean;
  backslashEscapes: boolean;
  recursiveCte: boolean;
}

export interface SqlDialectVocabulary {
  keywords: readonly string[];
  functions: readonly string[];
  types: readonly string[];
  operators: readonly string[];
}

export interface SqlDialectProfile {
  id: SqlDialectId;
  family: SqlDialectFamily;
  codeMirrorDialect: SQLDialect;
  identifierQuote: '"' | "`" | "[";
  defaultShell: SqlShellId;
  capabilities: SqlDialectCapabilities;
  vocabulary: SqlDialectVocabulary;
}

export interface SqlShellProfile {
  id: SqlShellId;
  dialects: readonly SqlDialectId[];
  commandPrefix: "\\" | "." | null;
  commands: readonly string[];
}

export const COMMON_SQL_KEYWORDS: readonly string[] = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS",
  "IN",
  "LIKE",
  "BETWEEN",
  "EXISTS",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "OUTER JOIN",
  "CROSS JOIN",
  "ON",
  "USING",
  "AS",
  "DISTINCT",
  "UNION",
  "INTERSECT",
  "EXCEPT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "INSERT",
  "INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE",
  "CREATE",
  "TABLE",
  "VIEW",
  "INDEX",
  "DROP",
  "ALTER",
  "ADD",
  "COLUMN",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "DEFAULT",
  "CHECK",
  "CONSTRAINT",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
  "TRUNCATE",
  "WITH",
  "RECURSIVE",
];

const POSTGRES_KEYWORDS: readonly string[] = [
  "RETURNING",
  "ILIKE",
  "SERIAL",
  "BIGSERIAL",
  "JSONB",
  "EXCLUDED",
  "ON CONFLICT",
  "MATERIALIZED VIEW",
];

const MYSQL_KEYWORDS: readonly string[] = [
  "SHOW",
  "DESCRIBE",
  "USE",
  "AUTO_INCREMENT",
  "REPLACE INTO",
  "DUAL",
  "ENGINE",
  "ON DUPLICATE KEY UPDATE",
  "DUPLICATE KEY UPDATE",
];

const MARIADB_KEYWORDS: readonly string[] = [...MYSQL_KEYWORDS, "RETURNING"];

const SQLITE_KEYWORDS: readonly string[] = [
  "PRAGMA",
  "WITHOUT ROWID",
  "IIF",
  "GLOB",
  "AUTOINCREMENT",
];

const DUCKDB_KEYWORDS: readonly string[] = ["DESCRIBE", "SUMMARIZE"];

const ORACLE_KEYWORDS: readonly string[] = [
  "CONNECT BY",
  "START WITH",
  "MINUS",
  "MERGE",
  "DUAL",
  "ROWNUM",
  "ROWID",
  "SYSDATE",
  "SYSTIMESTAMP",
  "FETCH FIRST",
  "OFFSET",
  "RETURNING INTO",
  "CREATE SEQUENCE",
  "SEQUENCE",
  "NEXTVAL",
  "CURRVAL",
  "SYNONYM",
  "CREATE SYNONYM",
  "CREATE PUBLIC SYNONYM",
  "PACKAGE",
  "PACKAGE BODY",
  "DBMS_OUTPUT",
  "DBMS_RANDOM",
  "DBMS_LOB",
];

export const COMMON_SQL_FUNCTIONS: readonly string[] = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NULLIF",
  "CAST",
  "CONCAT",
  "LENGTH",
  "UPPER",
  "LOWER",
  "TRIM",
  "SUBSTRING",
  "EXTRACT",
  "NOW",
  "CURRENT_TIMESTAMP",
];

const POSTGRESQL_SQL_FUNCTIONS: readonly string[] = [
  "DATE_TRUNC",
  "TO_CHAR",
  "TO_TIMESTAMP",
  "JSONB_BUILD_OBJECT",
  "JSONB_AGG",
  "ARRAY_AGG",
];

const MYSQL_SQL_FUNCTIONS: readonly string[] = [
  "IFNULL",
  "DATE_FORMAT",
  "STR_TO_DATE",
  "CURDATE",
  "CURTIME",
  "UTC_TIMESTAMP",
  "GROUP_CONCAT",
  "JSON_EXTRACT",
  "JSON_UNQUOTE",
  "JSON_OBJECT",
  "JSON_ARRAY",
  "UUID",
  "LAST_INSERT_ID",
  "DATABASE",
  "USER",
  "VERSION",
];

const SQLITE_SQL_FUNCTIONS: readonly string[] = [
  "DATE",
  "TIME",
  "DATETIME",
  "STRFTIME",
  "JULIANDAY",
  "IFNULL",
];

const DUCKDB_SQL_FUNCTIONS: readonly string[] = [
  "DATE_TRUNC",
  "STRFTIME",
  "IFNULL",
  "LIST",
  "STRUCT_PACK",
];

const ORACLE_SQL_FUNCTIONS: readonly string[] = [
  "NVL",
  "NVL2",
  "DECODE",
  "TO_CHAR",
  "TO_DATE",
  "TO_TIMESTAMP",
  "TRUNC",
  "ADD_MONTHS",
  "MONTHS_BETWEEN",
  "LISTAGG",
  "REGEXP_LIKE",
  "REGEXP_REPLACE",
  "REGEXP_SUBSTR",
  "SYS_CONTEXT",
  "DBMS_OUTPUT.PUT_LINE",
  "DBMS_RANDOM.VALUE",
  "DBMS_LOB.SUBSTR",
];

const COMMON_CAPABILITIES: SqlDialectCapabilities = {
  schemas: true,
  returning: false,
  ilike: false,
  onConflict: false,
  limitOffsetComma: false,
  dollarQuotedStrings: false,
  backslashEscapes: false,
  recursiveCte: true,
};

function vocabulary(
  keywords: readonly string[],
  functions: readonly string[],
): SqlDialectVocabulary {
  return {
    keywords: [...keywords, ...COMMON_SQL_KEYWORDS],
    functions: [...COMMON_SQL_FUNCTIONS, ...functions],
    types: [],
    operators: [],
  };
}

export const SQL_DIALECT_PROFILES: Record<SqlDialectId, SqlDialectProfile> = {
  postgresql: {
    id: "postgresql",
    family: "postgres",
    codeMirrorDialect: PostgreSQL,
    identifierQuote: '"',
    defaultShell: "psql",
    capabilities: {
      ...COMMON_CAPABILITIES,
      returning: true,
      ilike: true,
      onConflict: true,
      dollarQuotedStrings: true,
    },
    vocabulary: vocabulary(POSTGRES_KEYWORDS, POSTGRESQL_SQL_FUNCTIONS),
  },
  mysql: {
    id: "mysql",
    family: "mysql",
    codeMirrorDialect: MySQL,
    identifierQuote: "`",
    defaultShell: "mysql-client",
    capabilities: {
      ...COMMON_CAPABILITIES,
      schemas: false,
      limitOffsetComma: true,
      backslashEscapes: true,
    },
    vocabulary: vocabulary(MYSQL_KEYWORDS, MYSQL_SQL_FUNCTIONS),
  },
  mariadb: {
    id: "mariadb",
    family: "mysql",
    codeMirrorDialect: MySQL,
    identifierQuote: "`",
    defaultShell: "mysql-client",
    capabilities: {
      ...COMMON_CAPABILITIES,
      schemas: false,
      returning: true,
      limitOffsetComma: true,
      backslashEscapes: true,
    },
    vocabulary: vocabulary(MARIADB_KEYWORDS, MYSQL_SQL_FUNCTIONS),
  },
  sqlite: {
    id: "sqlite",
    family: "sqlite",
    codeMirrorDialect: SQLite,
    identifierQuote: '"',
    defaultShell: "sqlite-cli",
    capabilities: {
      ...COMMON_CAPABILITIES,
      schemas: false,
      returning: true,
      onConflict: true,
    },
    vocabulary: vocabulary(SQLITE_KEYWORDS, SQLITE_SQL_FUNCTIONS),
  },
  duckdb: {
    id: "duckdb",
    family: "duckdb",
    codeMirrorDialect: StandardSQL,
    identifierQuote: '"',
    defaultShell: "none",
    capabilities: { ...COMMON_CAPABILITIES },
    vocabulary: vocabulary(DUCKDB_KEYWORDS, DUCKDB_SQL_FUNCTIONS),
  },
  mssql: {
    id: "mssql",
    family: "mssql",
    codeMirrorDialect: StandardSQL,
    identifierQuote: "[",
    defaultShell: "none",
    capabilities: { ...COMMON_CAPABILITIES },
    vocabulary: vocabulary([], []),
  },
  oracle: {
    id: "oracle",
    family: "oracle",
    codeMirrorDialect: StandardSQL,
    identifierQuote: '"',
    defaultShell: "none",
    capabilities: { ...COMMON_CAPABILITIES },
    vocabulary: {
      ...vocabulary(ORACLE_KEYWORDS, ORACLE_SQL_FUNCTIONS),
      types: ["NUMBER", "VARCHAR2", "NVARCHAR2", "CLOB", "BLOB", "DATE"],
      operators: [":BIND", ":ID", ":NAME", ":START_DATE", ":END_DATE"],
    },
  },
  ansi: {
    id: "ansi",
    family: "ansi",
    codeMirrorDialect: StandardSQL,
    identifierQuote: '"',
    defaultShell: "none",
    capabilities: { ...COMMON_CAPABILITIES },
    vocabulary: vocabulary([], []),
  },
};

export const SQL_SHELL_PROFILES: Record<SqlShellId, SqlShellProfile> = {
  none: {
    id: "none",
    dialects: [
      "ansi",
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "duckdb",
      "mssql",
      "oracle",
    ],
    commandPrefix: null,
    commands: [],
  },
  psql: {
    id: "psql",
    dialects: ["postgresql"],
    commandPrefix: "\\",
    commands: [
      "\\d",
      "\\d+",
      "\\dt",
      "\\dv",
      "\\df",
      "\\dn",
      "\\copy",
      "\\conninfo",
    ],
  },
  "mysql-client": {
    id: "mysql-client",
    dialects: ["mysql", "mariadb"],
    commandPrefix: "\\",
    commands: ["\\G", "\\c", "\\q", "source", "delimiter", "tee", "notee"],
  },
  "sqlite-cli": {
    id: "sqlite-cli",
    dialects: ["sqlite"],
    commandPrefix: ".",
    commands: [".tables", ".schema", ".mode", ".headers", ".read", ".quit"],
  },
};

export function sqlDialectIdForDatabaseType(
  dbType: DatabaseType | undefined,
): SqlDialectId | null {
  switch (dbType) {
    case "postgresql":
    case "mysql":
    case "mariadb":
    case "sqlite":
    case "duckdb":
    case "mssql":
    case "oracle":
      return dbType;
    case "mongodb":
    case "redis":
    case undefined:
      return null;
  }
  return null;
}

export function getSqlDialectProfile(
  dialectId: SqlDialectId,
): SqlDialectProfile {
  return SQL_DIALECT_PROFILES[dialectId];
}

export function getSqlDialectProfileForDatabaseType(
  dbType: DatabaseType | undefined,
): SqlDialectProfile | null {
  const dialectId = sqlDialectIdForDatabaseType(dbType);
  return dialectId ? getSqlDialectProfile(dialectId) : null;
}

export function codeMirrorDialectForDatabaseType(
  dbType: DatabaseType | undefined,
): SQLDialect {
  return (
    getSqlDialectProfileForDatabaseType(dbType)?.codeMirrorDialect ??
    StandardSQL
  );
}

export function getSqlKeywordsForDatabaseType(
  dbType: DatabaseType | undefined,
): readonly string[] {
  if (dbType === undefined) return COMMON_SQL_KEYWORDS;
  if (dbType === "mongodb" || dbType === "redis") return [];
  return (
    getSqlDialectProfileForDatabaseType(dbType)?.vocabulary.keywords ??
    COMMON_SQL_KEYWORDS
  );
}

export function getSqlFunctionsForDatabaseType(
  dbType: DatabaseType | undefined,
): readonly string[] {
  if (dbType === undefined) {
    return SQL_DIALECT_PROFILES.postgresql.vocabulary.functions;
  }
  return (
    getSqlDialectProfileForDatabaseType(dbType)?.vocabulary.functions ??
    COMMON_SQL_FUNCTIONS
  );
}
