pub(super) fn builtin_keywords(dialect: &str) -> &'static [&'static str] {
    match dialect {
        "postgresql" => POSTGRESQL_KEYWORDS,
        "mysql" | "mariadb" => MYSQL_KEYWORDS,
        "sqlite" => SQLITE_KEYWORDS,
        "mssql" => MSSQL_KEYWORDS,
        "oracle" => ORACLE_KEYWORDS,
        _ => COMMON_KEYWORDS,
    }
}

pub(super) fn builtin_keyword_deltas(
    dialect: &str,
    server_version: Option<&str>,
) -> &'static [&'static str] {
    match dialect {
        "mariadb" if mariadb_server_version_supports_returning(server_version) => {
            MARIADB_KEYWORD_DELTAS
        }
        _ => &[],
    }
}

pub(super) fn mariadb_server_version_supports_returning(server_version: Option<&str>) -> bool {
    let Some(server_version) = server_version else {
        return true;
    };
    let Some(version) = parse_version_tuple(server_version) else {
        return true;
    };
    version_at_least(version, (10, 0, 5))
}

fn parse_version_tuple(raw: &str) -> Option<(u64, u64, u64)> {
    let normalized = if raw.to_ascii_lowercase().contains("mariadb") {
        raw.strip_prefix("5.5.5-").unwrap_or(raw)
    } else {
        raw
    };
    let start = normalized.find(|character: char| character.is_ascii_digit())?;
    let candidate = normalized[start..]
        .split(|character: char| !(character.is_ascii_digit() || character == '.'))
        .next()?;

    let mut parts = [0_u64; 3];
    let mut count = 0;
    for (index, part) in candidate.split('.').take(3).enumerate() {
        if part.is_empty() {
            break;
        }
        parts[index] = part.parse().ok()?;
        count += 1;
    }

    if count == 0 {
        None
    } else {
        Some((parts[0], parts[1], parts[2]))
    }
}

fn version_at_least(version: (u64, u64, u64), minimum: (u64, u64, u64)) -> bool {
    version.0 > minimum.0
        || (version.0 == minimum.0
            && (version.1 > minimum.1 || (version.1 == minimum.1 && version.2 >= minimum.2)))
}

pub(super) fn builtin_functions(dialect: &str) -> &'static [&'static str] {
    match dialect {
        "postgresql" => POSTGRESQL_FUNCTIONS,
        "mysql" | "mariadb" => MYSQL_FUNCTIONS,
        "sqlite" => SQLITE_FUNCTIONS,
        "mssql" => MSSQL_FUNCTIONS,
        "oracle" => ORACLE_FUNCTIONS,
        _ => COMMON_FUNCTIONS,
    }
}

pub(super) fn builtin_bind_identifiers(dialect: &str) -> &'static [&'static str] {
    match dialect {
        "oracle" => ORACLE_BIND_IDENTIFIERS,
        _ => &[],
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

pub(super) struct ExtensionCompletionCandidate {
    pub label: &'static str,
    pub kind: &'static str,
    pub detail: &'static str,
    pub boost: i32,
}

struct ExtensionCompletionPack {
    extension: &'static str,
    candidates: &'static [ExtensionCompletionCandidate],
}

pub(super) fn postgresql_extension_pack(
    extension_name: &str,
) -> Option<&'static [ExtensionCompletionCandidate]> {
    POSTGRESQL_EXTENSION_PACKS
        .iter()
        .find(|pack| pack.extension.eq_ignore_ascii_case(extension_name))
        .map(|pack| pack.candidates)
}

#[rustfmt::skip]
const COMMON_KEYWORDS: &[&str] = &["SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE", "BETWEEN", "EXISTS", "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET", "JOIN", "INNER JOIN", "LEFT JOIN", "RIGHT JOIN", "FULL JOIN", "OUTER JOIN", "CROSS JOIN", "ON", "USING", "AS", "DISTINCT", "UNION", "INTERSECT", "EXCEPT", "CASE", "WHEN", "THEN", "ELSE", "END", "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "VIEW", "INDEX", "DROP", "ALTER", "ADD", "COLUMN", "PRIMARY KEY", "FOREIGN KEY", "REFERENCES", "DEFAULT", "CHECK", "CONSTRAINT", "BEGIN", "COMMIT", "ROLLBACK", "TRUNCATE", "WITH", "RECURSIVE"];

#[rustfmt::skip]
const POSTGRESQL_KEYWORDS: &[&str] = &["ABORT", "ANALYZE", "ATTACH", "CALL", "CHECKPOINT", "COMMENT", "CONFLICT", "COPY", "CREATE EXTENSION", "CREATE MATERIALIZED VIEW", "CREATE SCHEMA", "CREATE SEQUENCE", "CREATE TYPE", "DEALLOCATE", "DEFERRABLE", "DISCARD", "DO", "EXPLAIN", "FETCH", "FILTER", "GRANT", "ILIKE", "LISTEN", "LOAD", "LOCK", "MATERIALIZED VIEW", "MOVE", "NOTIFY", "ON CONFLICT", "PREPARE", "REASSIGN OWNED", "REFRESH MATERIALIZED VIEW", "REINDEX", "RELEASE SAVEPOINT", "RESET", "RETURNING", "REVOKE", "SAVEPOINT", "SECURITY", "SERIAL", "BIGSERIAL", "SHOW", "TABLESAMPLE", "UNLISTEN", "VACUUM", "WINDOW"];

#[rustfmt::skip]
const MYSQL_KEYWORDS: &[&str] = &["ACCESSIBLE", "ACCOUNT", "ACTION", "AFTER", "AGAINST", "ALGORITHM", "ANALYZE", "AUTO_INCREMENT", "BEFORE", "CALL", "CHANGE", "DATABASE", "DATABASES", "DELAYED", "DESCRIBE", "DETERMINISTIC", "DUAL", "DUPLICATE KEY UPDATE", "ENGINE", "EVENT", "EXPLAIN", "FULLTEXT", "GENERATED", "HIGH_PRIORITY", "IGNORE", "INFILE", "JSON_TABLE", "KEY", "KEYS", "KILL", "LIMIT", "LOAD", "LOCK", "LOW_PRIORITY", "MATCH", "ON DUPLICATE KEY UPDATE", "OPTIMIZE", "OUTFILE", "PARTITION", "PROCEDURE", "PURGE", "QUALIFY", "RENAME", "REPAIR", "REPLACE", "REPLACE INTO", "REQUIRE", "RESIGNAL", "RLIKE", "SCHEMA", "SCHEMAS", "SEPARATOR", "SHOW", "SIGNAL", "SPATIAL", "STRAIGHT_JOIN", "TABLESAMPLE", "TERMINATED", "TRIGGER", "UNLOCK", "UNSIGNED", "USE", "ZEROFILL"];

#[rustfmt::skip]
const MARIADB_KEYWORD_DELTAS: &[&str] = &["RETURNING"];

#[rustfmt::skip]
const SQLITE_KEYWORDS: &[&str] = &["ABORT", "AUTOINCREMENT", "CONFLICT", "FAIL", "GLOB", "IIF", "IGNORE", "INDEXED BY", "INSERT OR IGNORE", "INSERT OR REPLACE", "PRAGMA", "RAISE", "REPLACE", "ROWID", "VACUUM", "WITHOUT ROWID"];

#[rustfmt::skip]
const ORACLE_KEYWORDS: &[&str] = &["CONNECT BY", "START WITH", "MINUS", "MERGE", "DUAL", "ROWNUM", "ROWID", "SYSDATE", "SYSTIMESTAMP", "FETCH FIRST", "RETURNING INTO", "CREATE SEQUENCE", "SEQUENCE", "NEXTVAL", "CURRVAL", "SYNONYM", "CREATE SYNONYM", "CREATE PUBLIC SYNONYM", "PACKAGE", "PACKAGE BODY", "DBMS_OUTPUT", "DBMS_RANDOM", "DBMS_LOB"];

#[rustfmt::skip]
const MSSQL_KEYWORDS: &[&str] = &["APPLY", "CROSS APPLY", "OUTER APPLY", "TOP", "OFFSET", "FETCH NEXT", "EXEC", "EXECUTE", "CREATE PROCEDURE", "ALTER PROCEDURE", "DROP PROCEDURE", "MERGE", "OUTPUT", "IDENTITY", "NVARCHAR", "DATETIME2", "UNIQUEIDENTIFIER", "TRY_CONVERT", "TRY_CAST", "PIVOT", "UNPIVOT"];

#[rustfmt::skip]
const COMMON_FUNCTIONS: &[&str] = &["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CAST", "CONCAT", "LENGTH", "UPPER", "LOWER", "TRIM", "SUBSTRING", "EXTRACT", "NOW", "CURRENT_TIMESTAMP"];

#[rustfmt::skip]
const POSTGRESQL_FUNCTIONS: &[&str] = &["ABS", "AGE", "ARRAY_AGG", "ARRAY_APPEND", "ARRAY_LENGTH", "DATE_BIN", "DATE_PART", "DATE_TRUNC", "FORMAT", "JSON_AGG", "JSON_BUILD_ARRAY", "JSON_BUILD_OBJECT", "JSON_OBJECT_AGG", "JSONB_AGG", "JSONB_ARRAY_ELEMENTS", "JSONB_BUILD_ARRAY", "JSONB_BUILD_OBJECT", "JSONB_EACH", "JSONB_EXTRACT_PATH", "JSONB_OBJECT_AGG", "JSONB_PRETTY", "PG_BACKEND_PID", "PG_CANCEL_BACKEND", "PG_SLEEP", "PG_TERMINATE_BACKEND", "RANDOM", "REGEXP_REPLACE", "SPLIT_PART", "STRING_AGG", "TO_CHAR", "TO_DATE", "TO_JSON", "TO_JSONB", "TO_NUMBER", "TO_TIMESTAMP"];

#[rustfmt::skip]
const MYSQL_FUNCTIONS: &[&str] = &["ABS", "ACOS", "ADDDATE", "ADDTIME", "AES_DECRYPT", "AES_ENCRYPT", "ANY_VALUE", "ASCII", "BIN_TO_UUID", "BIT_AND", "BIT_COUNT", "BIT_LENGTH", "BIT_OR", "BIT_XOR", "CHAR_LENGTH", "CONNECTION_ID", "CONVERT_TZ", "CURDATE", "CURTIME", "DATABASE", "DATE_ADD", "DATE_FORMAT", "DATE_SUB", "DAYOFMONTH", "DAYOFWEEK", "DAYOFYEAR", "FIELD", "FIND_IN_SET", "FORMAT_BYTES", "FROM_UNIXTIME", "GET_FORMAT", "GET_LOCK", "GROUP_CONCAT", "IF", "IFNULL", "INET_ATON", "INET_NTOA", "IS_FREE_LOCK", "IS_USED_LOCK", "IS_UUID", "JSON_ARRAY", "JSON_ARRAYAGG", "JSON_CONTAINS", "JSON_CONTAINS_PATH", "JSON_DEPTH", "JSON_EXTRACT", "JSON_KEYS", "JSON_LENGTH", "JSON_MERGE_PATCH", "JSON_OBJECT", "JSON_OBJECTAGG", "JSON_OVERLAPS", "JSON_PRETTY", "JSON_QUOTE", "JSON_REMOVE", "JSON_REPLACE", "JSON_SCHEMA_VALID", "JSON_SEARCH", "JSON_SET", "JSON_TABLE", "JSON_TYPE", "JSON_UNQUOTE", "JSON_VALID", "JSON_VALUE", "LAST_INSERT_ID", "LOCALTIME", "LOCALTIMESTAMP", "MAKEDATE", "MAKETIME", "MATCH", "NOW", "PERIOD_ADD", "PERIOD_DIFF", "RAND", "REGEXP_INSTR", "REGEXP_LIKE", "REGEXP_REPLACE", "REGEXP_SUBSTR", "RELEASE_LOCK", "ROW_COUNT", "SESSION_USER", "SHA2", "ST_SRID", "STR_TO_DATE", "SYSDATE", "SYSTEM_USER", "TIMESTAMPADD", "TIMESTAMPDIFF", "TO_BASE64", "UTC_DATE", "UTC_TIME", "UTC_TIMESTAMP", "UUID", "UUID_SHORT", "UUID_TO_BIN", "VALUES", "VERSION", "WEEKOFYEAR", "YEARWEEK"];

#[rustfmt::skip]
const SQLITE_FUNCTIONS: &[&str] = &["DATE", "TIME", "DATETIME", "JULIANDAY", "STRFTIME", "IIF", "IFNULL", "JSON", "JSON_ARRAY", "JSON_EXTRACT", "JSON_GROUP_ARRAY", "JSON_GROUP_OBJECT", "JSON_OBJECT", "JSON_PATCH", "JSON_REMOVE", "JSON_REPLACE", "JSON_SET", "TOTAL", "TYPEOF"];

#[rustfmt::skip]
const ORACLE_FUNCTIONS: &[&str] = &["ABS", "ADD_MONTHS", "DECODE", "LISTAGG", "MONTHS_BETWEEN", "NVL", "NVL2", "REGEXP_LIKE", "REGEXP_REPLACE", "REGEXP_SUBSTR", "SYS_CONTEXT", "TO_CHAR", "TO_DATE", "TO_TIMESTAMP", "TRUNC", "DBMS_OUTPUT.PUT_LINE", "DBMS_RANDOM.VALUE", "DBMS_LOB.SUBSTR"];

#[rustfmt::skip]
const ORACLE_BIND_IDENTIFIERS: &[&str] = &[":BIND", ":ID", ":NAME", ":START_DATE", ":END_DATE", ":LIMIT"];

#[rustfmt::skip]
const MSSQL_FUNCTIONS: &[&str] = &["APP_NAME", "CHOOSE", "CURRENT_USER", "DATEADD", "DATEDIFF", "DATEFROMPARTS", "DATENAME", "DATEPART", "DB_NAME", "EOMONTH", "FORMAT", "GETDATE", "GETUTCDATE", "HOST_NAME", "IIF", "ISDATE", "ISNULL", "JSON_MODIFY", "JSON_QUERY", "JSON_VALUE", "NEWID", "OBJECT_ID", "OPENJSON", "SCOPE_IDENTITY", "SESSION_USER", "STRING_AGG", "SUSER_SNAME", "SYSDATETIME", "SYSUTCDATETIME", "TRY_CAST", "TRY_CONVERT"];

#[rustfmt::skip]
const PSQL_COMMANDS: &[&str] = &["\\a", "\\bind", "\\bind_named", "\\c", "\\C", "\\cd", "\\close_prepared", "\\conninfo", "\\connect", "\\copy", "\\copyright", "\\crosstabview", "\\d", "\\d+", "\\da", "\\dA", "\\dAc", "\\dAf", "\\dAo", "\\dAp", "\\db", "\\dc", "\\dconfig", "\\dC", "\\dd", "\\ddp", "\\dD", "\\des", "\\det", "\\deu", "\\dew", "\\df", "\\dF", "\\dFd", "\\dFp", "\\dFt", "\\dg", "\\di", "\\dl", "\\dL", "\\dm", "\\dn", "\\do", "\\dO", "\\dp", "\\dP", "\\drds", "\\dRp", "\\dRs", "\\ds", "\\dt", "\\dT", "\\du", "\\dv", "\\dx", "\\dy", "\\echo", "\\edit", "\\ef", "\\encoding", "\\errverbose", "\\ev", "\\f", "\\flush", "\\flushrequest", "\\g", "\\gdesc", "\\getenv", "\\getresults", "\\gexec", "\\gset", "\\gx", "\\h", "\\help", "\\H", "\\if", "\\elif", "\\else", "\\endif", "\\i", "\\include", "\\include_relative", "\\ir", "\\list", "\\lo_export", "\\lo_import", "\\lo_list", "\\lo_unlink", "\\o", "\\out", "\\parse", "\\password", "\\pipe", "\\print", "\\prompt", "\\pset", "\\q", "\\qecho", "\\quit", "\\r", "\\reset", "\\restrict", "\\s", "\\sendpipeline", "\\set", "\\setenv", "\\sf", "\\sf+", "\\startpipeline", "\\sv", "\\sv+", "\\syncpipeline", "\\t", "\\T", "\\timing", "\\unrestrict", "\\unset", "\\w", "\\warn", "\\watch", "\\write", "\\x", "\\z", "\\!", "\\?", "\\;"];

#[rustfmt::skip]
const MYSQL_CLIENT_COMMANDS: &[&str] = &["?", "\\?", "charset", "\\C", "clear", "\\c", "connect", "\\r", "delimiter", "\\d", "edit", "\\e", "ego", "\\G", "exit", "\\q", "go", "\\g", "help", "\\h", "nopager", "\\n", "notee", "\\t", "pager", "\\P", "print", "\\p", "prompt", "\\R", "quit", "rehash", "\\#", "resetconnection", "\\x", "source", "\\.", "ssl_session_data_print", "status", "\\s", "system", "\\!", "tee", "\\T", "use", "\\u", "warnings", "\\W", "nowarning", "\\w", "query_attributes"];

#[rustfmt::skip]
const SQLITE_CLI_COMMANDS: &[&str] = &[".archive", ".backup", ".bail", ".cd", ".changes", ".clone", ".connection", ".databases", ".dbconfig", ".dbinfo", ".dump", ".echo", ".eqp", ".excel", ".exit", ".expert", ".explain", ".fullschema", ".headers", ".help", ".import", ".indexes", ".limit", ".lint", ".load", ".log", ".mode", ".nonce", ".nullvalue", ".once", ".open", ".output", ".parameter", ".print", ".progress", ".prompt", ".quit", ".read", ".recover", ".restore", ".save", ".scanstats", ".schema", ".selftest", ".separator", ".session", ".sha3sum", ".shell", ".show", ".stats", ".system", ".tables", ".timeout", ".timer", ".trace", ".vfsinfo", ".vfslist", ".vfsname", ".width"];

#[rustfmt::skip]
const PGCRYPTO_CANDIDATES: &[ExtensionCompletionCandidate] = &[
    ExtensionCompletionCandidate { label: "GEN_RANDOM_UUID", kind: "function", detail: "function", boost: 26 },
    ExtensionCompletionCandidate { label: "CRYPT", kind: "function", detail: "function", boost: 24 },
    ExtensionCompletionCandidate { label: "DIGEST", kind: "function", detail: "function", boost: 24 },
    ExtensionCompletionCandidate { label: "HMAC", kind: "function", detail: "function", boost: 24 },
    ExtensionCompletionCandidate { label: "PGP_SYM_ENCRYPT", kind: "function", detail: "function", boost: 24 },
    ExtensionCompletionCandidate { label: "PGP_SYM_DECRYPT", kind: "function", detail: "function", boost: 24 },
];

#[rustfmt::skip]
const UUID_OSSP_CANDIDATES: &[ExtensionCompletionCandidate] = &[
    ExtensionCompletionCandidate { label: "UUID_GENERATE_V1", kind: "function", detail: "function", boost: 26 },
    ExtensionCompletionCandidate { label: "UUID_GENERATE_V4", kind: "function", detail: "function", boost: 26 },
    ExtensionCompletionCandidate { label: "UUID_NIL", kind: "function", detail: "function", boost: 24 },
];

#[rustfmt::skip]
const POSTGIS_CANDIDATES: &[ExtensionCompletionCandidate] = &[
    ExtensionCompletionCandidate { label: "GEOMETRY", kind: "keyword", detail: "type", boost: 25 },
    ExtensionCompletionCandidate { label: "GEOGRAPHY", kind: "keyword", detail: "type", boost: 25 },
    ExtensionCompletionCandidate { label: "ST_ASGEOJSON", kind: "function", detail: "function", boost: 25 },
    ExtensionCompletionCandidate { label: "ST_DISTANCE", kind: "function", detail: "function", boost: 25 },
    ExtensionCompletionCandidate { label: "ST_INTERSECTS", kind: "function", detail: "function", boost: 25 },
    ExtensionCompletionCandidate { label: "ST_SETSRID", kind: "function", detail: "function", boost: 25 },
    ExtensionCompletionCandidate { label: "ST_TRANSFORM", kind: "function", detail: "function", boost: 25 },
];

#[rustfmt::skip]
const PGVECTOR_CANDIDATES: &[ExtensionCompletionCandidate] = &[
    ExtensionCompletionCandidate { label: "VECTOR", kind: "keyword", detail: "type", boost: 25 },
    ExtensionCompletionCandidate { label: "HALFVEC", kind: "keyword", detail: "type", boost: 25 },
    ExtensionCompletionCandidate { label: "SPARSEVEC", kind: "keyword", detail: "type", boost: 25 },
    ExtensionCompletionCandidate { label: "<->", kind: "operator", detail: "operator", boost: 22 },
    ExtensionCompletionCandidate { label: "<=>", kind: "operator", detail: "operator", boost: 22 },
    ExtensionCompletionCandidate { label: "<#>", kind: "operator", detail: "operator", boost: 22 },
];

#[rustfmt::skip]
const CITEXT_CANDIDATES: &[ExtensionCompletionCandidate] = &[
    ExtensionCompletionCandidate { label: "CITEXT", kind: "keyword", detail: "type", boost: 25 },
];

#[rustfmt::skip]
const HSTORE_CANDIDATES: &[ExtensionCompletionCandidate] = &[
    ExtensionCompletionCandidate { label: "HSTORE", kind: "keyword", detail: "type", boost: 25 },
    ExtensionCompletionCandidate { label: "AKEYS", kind: "function", detail: "function", boost: 24 },
    ExtensionCompletionCandidate { label: "AVALS", kind: "function", detail: "function", boost: 24 },
    ExtensionCompletionCandidate { label: "HSTORE_TO_JSONB", kind: "function", detail: "function", boost: 24 },
];

#[rustfmt::skip]
const PG_TRGM_CANDIDATES: &[ExtensionCompletionCandidate] = &[
    ExtensionCompletionCandidate { label: "SIMILARITY", kind: "function", detail: "function", boost: 25 },
    ExtensionCompletionCandidate { label: "WORD_SIMILARITY", kind: "function", detail: "function", boost: 25 },
    ExtensionCompletionCandidate { label: "SHOW_TRGM", kind: "function", detail: "function", boost: 24 },
    ExtensionCompletionCandidate { label: "%", kind: "operator", detail: "operator", boost: 22 },
    ExtensionCompletionCandidate { label: "<%", kind: "operator", detail: "operator", boost: 22 },
    ExtensionCompletionCandidate { label: "%>", kind: "operator", detail: "operator", boost: 22 },
];

const POSTGRESQL_EXTENSION_PACKS: &[ExtensionCompletionPack] = &[
    ExtensionCompletionPack {
        extension: "pgcrypto",
        candidates: PGCRYPTO_CANDIDATES,
    },
    ExtensionCompletionPack {
        extension: "uuid-ossp",
        candidates: UUID_OSSP_CANDIDATES,
    },
    ExtensionCompletionPack {
        extension: "postgis",
        candidates: POSTGIS_CANDIDATES,
    },
    ExtensionCompletionPack {
        extension: "pgvector",
        candidates: PGVECTOR_CANDIDATES,
    },
    ExtensionCompletionPack {
        extension: "citext",
        candidates: CITEXT_CANDIDATES,
    },
    ExtensionCompletionPack {
        extension: "hstore",
        candidates: HSTORE_CANDIDATES,
    },
    ExtensionCompletionPack {
        extension: "pg_trgm",
        candidates: PG_TRGM_CANDIDATES,
    },
];
