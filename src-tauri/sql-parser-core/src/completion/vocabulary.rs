pub(super) fn builtin_keywords(dialect: &str) -> &'static [&'static str] {
    match dialect {
        "postgresql" => POSTGRESQL_KEYWORDS,
        "mysql" | "mariadb" => MYSQL_KEYWORDS,
        "sqlite" => SQLITE_KEYWORDS,
        _ => COMMON_KEYWORDS,
    }
}

pub(super) fn builtin_functions(dialect: &str) -> &'static [&'static str] {
    match dialect {
        "postgresql" => POSTGRESQL_FUNCTIONS,
        "mysql" | "mariadb" => MYSQL_FUNCTIONS,
        "sqlite" => SQLITE_FUNCTIONS,
        _ => COMMON_FUNCTIONS,
    }
}

pub(super) fn builtin_shell_commands(shell: &str) -> &'static [&'static str] {
    match shell {
        "psql" => PSQL_COMMANDS,
        "mysql-client" => MYSQL_CLIENT_COMMANDS,
        "sqlite-cli" => SQLITE_CLI_COMMANDS,
        _ => &[],
    }
}

#[rustfmt::skip]
const COMMON_KEYWORDS: &[&str] = &["SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE", "BETWEEN", "EXISTS", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "OUTER JOIN", "CROSS JOIN", "ON", "USING", "AS", "DISTINCT", "UNION", "INTERSECT", "EXCEPT", "CASE", "WHEN", "THEN", "ELSE", "END", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "VIEW", "INDEX", "DROP", "ALTER", "ADD", "COLUMN", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES", "DEFAULT", "CHECK", "CONSTRAINT", "BEGIN", "COMMIT", "ROLLBACK", "TRUNCATE", "WITH", "RECURSIVE"];

#[rustfmt::skip]
const POSTGRESQL_KEYWORDS: &[&str] = &["ABORT", "ANALYZE", "ATTACH", "CALL", "CHECKPOINT", "COMMENT", "CONFLICT", "COPY", "CREATE EXTENSION", "CREATE MATERIALIZED VIEW", "CREATE SCHEMA", "CREATE SEQUENCE", "CREATE TYPE", "DEALLOCATE", "DEFERRABLE", "DISCARD", "DO", "EXPLAIN", "FETCH", "FILTER", "GRANT", "ILIKE", "LISTEN", "LOAD", "LOCK", "MATERIALIZED VIEW", "MOVE", "NOTIFY", "ON CONFLICT", "PREPARE", "REASSIGN OWNED", "REFRESH MATERIALIZED VIEW", "REINDEX", "RELEASE SAVEPOINT", "RESET", "RETURNING", "REVOKE", "SAVEPOINT", "SECURITY", "SERIAL", "BIGSERIAL", "SHOW", "TABLESAMPLE", "UNLISTEN", "VACUUM", "WINDOW"];

#[rustfmt::skip]
const MYSQL_KEYWORDS: &[&str] = &["ACCESSIBLE", "ACCOUNT", "ACTION", "AFTER", "AGAINST", "ALGORITHM", "ANALYZE", "AUTO_INCREMENT", "BEFORE", "CALL", "CHANGE", "DATABASE", "DATABASES", "DELAYED", "DESCRIBE", "DETERMINISTIC", "DUAL", "DUPLICATE KEY UPDATE", "ENGINE", "EVENT", "EXPLAIN", "FULLTEXT", "GENERATED", "HIGH_PRIORITY", "IGNORE", "INFILE", "JSON_TABLE", "KEY", "KEYS", "KILL", "LIMIT", "LOAD", "LOCK", "LOW_PRIORITY", "MATCH", "ON DUPLICATE KEY UPDATE", "OPTIMIZE", "OUTFILE", "PARTITION", "PROCEDURE", "PURGE", "QUALIFY", "RENAME", "REPAIR", "REPLACE", "REPLACE INTO", "REQUIRE", "RESIGNAL", "RLIKE", "SCHEMA", "SCHEMAS", "SEPARATOR", "SHOW", "SIGNAL", "SPATIAL", "STRAIGHT_JOIN", "TABLESAMPLE", "TERMINATED", "TRIGGER", "UNLOCK", "UNSIGNED", "USE", "ZEROFILL"];

#[rustfmt::skip]
const SQLITE_KEYWORDS: &[&str] = &["ABORT", "AUTOINCREMENT", "CONFLICT", "FAIL", "GLOB", "IIF", "IGNORE", "INDEXED BY", "INSERT OR IGNORE", "INSERT OR REPLACE", "PRAGMA", "RAISE", "REPLACE", "ROWID", "VACUUM", "WITHOUT ROWID"];

#[rustfmt::skip]
const COMMON_FUNCTIONS: &[&str] = &["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CAST", "CONCAT", "LENGTH", "UPPER", "LOWER", "TRIM", "SUBSTRING", "EXTRACT", "NOW", "CURRENT_TIMESTAMP"];

#[rustfmt::skip]
const POSTGRESQL_FUNCTIONS: &[&str] = &["ABS", "AGE", "ARRAY_AGG", "ARRAY_APPEND", "ARRAY_LENGTH", "DATE_BIN", "DATE_PART", "DATE_TRUNC", "FORMAT", "GEN_RANDOM_UUID", "JSON_AGG", "JSON_BUILD_ARRAY", "JSON_BUILD_OBJECT", "JSON_OBJECT_AGG", "JSONB_AGG", "JSONB_ARRAY_ELEMENTS", "JSONB_BUILD_ARRAY", "JSONB_BUILD_OBJECT", "JSONB_EACH", "JSONB_EXTRACT_PATH", "JSONB_OBJECT_AGG", "JSONB_PRETTY", "PG_BACKEND_PID", "PG_CANCEL_BACKEND", "PG_SLEEP", "PG_TERMINATE_BACKEND", "RANDOM", "REGEXP_REPLACE", "SPLIT_PART", "STRING_AGG", "TO_CHAR", "TO_DATE", "TO_JSON", "TO_JSONB", "TO_NUMBER", "TO_TIMESTAMP"];

#[rustfmt::skip]
const MYSQL_FUNCTIONS: &[&str] = &["ABS", "ACOS", "ADDDATE", "ADDTIME", "AES_DECRYPT", "AES_ENCRYPT", "ANY_VALUE", "ASCII", "BIN_TO_UUID", "BIT_AND", "BIT_COUNT", "BIT_LENGTH", "BIT_OR", "BIT_XOR", "CHAR_LENGTH", "CONNECTION_ID", "CONVERT_TZ", "CURDATE", "CURTIME", "DATABASE", "DATE_ADD", "DATE_FORMAT", "DATE_SUB", "DAYOFMONTH", "DAYOFWEEK", "DAYOFYEAR", "FIELD", "FIND_IN_SET", "FORMAT_BYTES", "FROM_UNIXTIME", "GET_FORMAT", "GET_LOCK", "GROUP_CONCAT", "IF", "IFNULL", "INET_ATON", "INET_NTOA", "IS_FREE_LOCK", "IS_USED_LOCK", "IS_UUID", "JSON_ARRAY", "JSON_ARRAYAGG", "JSON_CONTAINS", "JSON_CONTAINS_PATH", "JSON_DEPTH", "JSON_EXTRACT", "JSON_KEYS", "JSON_LENGTH", "JSON_MERGE_PATCH", "JSON_OBJECT", "JSON_OBJECTAGG", "JSON_OVERLAPS", "JSON_PRETTY", "JSON_QUOTE", "JSON_REMOVE", "JSON_REPLACE", "JSON_SCHEMA_VALID", "JSON_SEARCH", "JSON_SET", "JSON_TABLE", "JSON_TYPE", "JSON_UNQUOTE", "JSON_VALID", "JSON_VALUE", "LAST_INSERT_ID", "LOCALTIME", "LOCALTIMESTAMP", "MAKEDATE", "MAKETIME", "MATCH", "NOW", "PERIOD_ADD", "PERIOD_DIFF", "RAND", "REGEXP_INSTR", "REGEXP_LIKE", "REGEXP_REPLACE", "REGEXP_SUBSTR", "RELEASE_LOCK", "ROW_COUNT", "SESSION_USER", "SHA2", "ST_SRID", "STR_TO_DATE", "SYSDATE", "SYSTEM_USER", "TIMESTAMPADD", "TIMESTAMPDIFF", "TO_BASE64", "UTC_DATE", "UTC_TIME", "UTC_TIMESTAMP", "UUID", "UUID_SHORT", "UUID_TO_BIN", "VALUES", "VERSION", "WEEKOFYEAR", "YEARWEEK"];

#[rustfmt::skip]
const SQLITE_FUNCTIONS: &[&str] = &["DATE", "TIME", "DATETIME", "JULIANDAY", "STRFTIME", "IIF", "IFNULL", "JSON", "JSON_ARRAY", "JSON_EXTRACT", "JSON_GROUP_ARRAY", "JSON_GROUP_OBJECT", "JSON_OBJECT", "JSON_PATCH", "JSON_REMOVE", "JSON_REPLACE", "JSON_SET", "TOTAL", "TYPEOF"];

#[rustfmt::skip]
const PSQL_COMMANDS: &[&str] = &["\\a", "\\bind", "\\bind_named", "\\c", "\\C", "\\cd", "\\close_prepared", "\\conninfo", "\\connect", "\\copy", "\\copyright", "\\crosstabview", "\\d", "\\d+", "\\da", "\\dA", "\\dAc", "\\dAf", "\\dAo", "\\dAp", "\\db", "\\dc", "\\dconfig", "\\dC", "\\dd", "\\ddp", "\\dD", "\\des", "\\det", "\\deu", "\\dew", "\\df", "\\dF", "\\dFd", "\\dFp", "\\dFt", "\\dg", "\\di", "\\dl", "\\dL", "\\dm", "\\dn", "\\do", "\\dO", "\\dp", "\\dP", "\\drds", "\\dRp", "\\dRs", "\\ds", "\\dt", "\\dT", "\\du", "\\dv", "\\dx", "\\dy", "\\echo", "\\edit", "\\ef", "\\encoding", "\\errverbose", "\\ev", "\\f", "\\flush", "\\flushrequest", "\\g", "\\gdesc", "\\getenv", "\\getresults", "\\gexec", "\\gset", "\\gx", "\\h", "\\help", "\\H", "\\if", "\\elif", "\\else", "\\endif", "\\i", "\\include", "\\include_relative", "\\ir", "\\list", "\\lo_export", "\\lo_import", "\\lo_list", "\\lo_unlink", "\\o", "\\out", "\\parse", "\\password", "\\pipe", "\\print", "\\prompt", "\\pset", "\\q", "\\qecho", "\\quit", "\\r", "\\reset", "\\restrict", "\\s", "\\sendpipeline", "\\set", "\\setenv", "\\sf", "\\sf+", "\\startpipeline", "\\sv", "\\sv+", "\\syncpipeline", "\\t", "\\T", "\\timing", "\\unrestrict", "\\unset", "\\w", "\\warn", "\\watch", "\\write", "\\x", "\\z", "\\!", "\\?", "\\;"];

#[rustfmt::skip]
const MYSQL_CLIENT_COMMANDS: &[&str] = &["?", "\\?", "charset", "\\C", "clear", "\\c", "connect", "\\r", "delimiter", "\\d", "edit", "\\e", "ego", "\\G", "exit", "\\q", "go", "\\g", "help", "\\h", "nopager", "\\n", "notee", "\\t", "pager", "\\P", "print", "\\p", "prompt", "\\R", "quit", "rehash", "\\#", "resetconnection", "\\x", "source", "\\.", "ssl_session_data_print", "status", "\\s", "system", "\\!", "tee", "\\T", "use", "\\u", "warnings", "\\W", "nowarning", "\\w", "query_attributes"];

#[rustfmt::skip]
const SQLITE_CLI_COMMANDS: &[&str] = &[".archive", ".backup", ".bail", ".cd", ".changes", ".clone", ".connection", ".databases", ".dbconfig", ".dbinfo", ".dump", ".echo", ".eqp", ".excel", ".exit", ".expert", ".explain", ".fullschema", ".headers", ".help", ".import", ".indexes", ".limit", ".lint", ".load", ".log", ".mode", ".nonce", ".nullvalue", ".once", ".open", ".output", ".parameter", ".print", ".progress", ".prompt", ".quit", ".read", ".recover", ".restore", ".save", ".scanstats", ".schema", ".selftest", ".separator", ".session", ".sha3sum", ".shell", ".show", ".stats", ".system", ".tables", ".timeout", ".timer", ".trace", ".vfsinfo", ".vfslist", ".vfsname", ".width"];
