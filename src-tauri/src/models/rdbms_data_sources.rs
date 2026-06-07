use super::DatabaseType;

pub const RDBMS_DATABASE_TYPES: &[DatabaseType] = &[
    DatabaseType::Postgresql,
    DatabaseType::Mysql,
    DatabaseType::Mariadb,
    DatabaseType::Sqlite,
    DatabaseType::Duckdb,
    DatabaseType::Mssql,
    DatabaseType::Oracle,
];

pub const RUNTIME_RDBMS_DATABASE_TYPES: &[DatabaseType] = &[
    DatabaseType::Postgresql,
    DatabaseType::Mysql,
    DatabaseType::Mariadb,
    DatabaseType::Sqlite,
    DatabaseType::Duckdb,
    DatabaseType::Mssql,
];

pub const SERVER_RDBMS_DATABASE_TYPES: &[DatabaseType] = &[
    DatabaseType::Postgresql,
    DatabaseType::Mysql,
    DatabaseType::Mariadb,
    DatabaseType::Mssql,
];

pub const FILE_RDBMS_DATABASE_TYPES: &[DatabaseType] =
    &[DatabaseType::Sqlite, DatabaseType::Duckdb];
