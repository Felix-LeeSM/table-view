// Exclude the built-in `sys`/`INFORMATION_SCHEMA` schemas plus every fixed
// database-role schema and `guest`, which SQL Server auto-creates in each database.
// User schemas (`dbo`, custom) are kept.
pub(super) const USER_SCHEMAS_SQL: &str = "\
SELECT s.name
FROM sys.schemas AS s
WHERE s.name NOT IN (
        N'sys', N'INFORMATION_SCHEMA', N'guest',
        N'db_accessadmin', N'db_backupoperator', N'db_datareader', N'db_datawriter',
        N'db_ddladmin', N'db_denydatareader', N'db_denydatawriter', N'db_owner',
        N'db_securityadmin'
      )
ORDER BY s.name";

pub(super) const USER_DATABASES_SQL: &str = "\
SELECT d.name
FROM sys.databases AS d
WHERE d.state_desc = N'ONLINE'
  AND HAS_DBACCESS(d.name) = 1
ORDER BY d.name";

pub(super) const CURRENT_DATABASE_SQL: &str = "SELECT DB_NAME()";

pub(super) const TABLES_SQL: &str = "\
SELECT t.name,
       CAST(COALESCE(SUM(CASE WHEN p.index_id IN (0, 1) THEN p.rows ELSE 0 END), 0) AS BIGINT) AS row_count
FROM sys.tables AS t
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
LEFT JOIN sys.partitions AS p ON p.object_id = t.object_id AND p.index_id IN (0, 1)
WHERE s.name = @P1
  AND t.is_ms_shipped = 0
GROUP BY t.name
ORDER BY t.name";

pub(super) const VIEWS_SQL: &str = "\
SELECT v.name,
       OBJECT_DEFINITION(v.object_id) AS definition
FROM sys.views AS v
JOIN sys.schemas AS s ON s.schema_id = v.schema_id
WHERE s.name = @P1
  AND v.is_ms_shipped = 0
ORDER BY v.name";

pub(super) const VIEW_DEFINITION_SQL: &str = "\
SELECT OBJECT_DEFINITION(v.object_id) AS definition
FROM sys.views AS v
JOIN sys.schemas AS s ON s.schema_id = v.schema_id
WHERE s.name = @P1
  AND v.name = @P2
  AND v.is_ms_shipped = 0";

pub(super) const OBJECT_COLUMNS_SQL: &str = "\
SELECT o.name AS object_name,
       c.name AS column_name,
       CASE
         WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN
           ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(NVARCHAR(16), c.max_length) END + N')'
         WHEN ty.name IN (N'nvarchar', N'nchar') THEN
           ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(NVARCHAR(16), c.max_length / 2) END + N')'
         WHEN ty.name IN (N'decimal', N'numeric') THEN
           ty.name + N'(' + CONVERT(NVARCHAR(16), c.precision) + N',' + CONVERT(NVARCHAR(16), c.scale) + N')'
         WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time') THEN
           ty.name + N'(' + CONVERT(NVARCHAR(16), c.scale) + N')'
         ELSE ty.name
       END AS column_type,
       ty.name AS data_type,
       c.is_nullable,
       dc.definition AS default_value,
       CONVERT(NVARCHAR(MAX), ep.value) AS comment
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
JOIN sys.columns AS c ON c.object_id = o.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
LEFT JOIN sys.extended_properties AS ep
  ON ep.major_id = c.object_id
 AND ep.minor_id = c.column_id
 AND ep.name = N'MS_Description'
WHERE s.name = @P1
  AND o.name = @P2
  AND o.type IN (N'U', N'V')
ORDER BY c.column_id";

pub(super) const SCHEMA_COLUMNS_SQL: &str = "\
SELECT o.name AS object_name,
       c.name AS column_name,
       CASE
         WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN
           ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(NVARCHAR(16), c.max_length) END + N')'
         WHEN ty.name IN (N'nvarchar', N'nchar') THEN
           ty.name + N'(' + CASE WHEN c.max_length = -1 THEN N'max' ELSE CONVERT(NVARCHAR(16), c.max_length / 2) END + N')'
         WHEN ty.name IN (N'decimal', N'numeric') THEN
           ty.name + N'(' + CONVERT(NVARCHAR(16), c.precision) + N',' + CONVERT(NVARCHAR(16), c.scale) + N')'
         WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time') THEN
           ty.name + N'(' + CONVERT(NVARCHAR(16), c.scale) + N')'
         ELSE ty.name
       END AS column_type,
       ty.name AS data_type,
       c.is_nullable,
       dc.definition AS default_value,
       CONVERT(NVARCHAR(MAX), ep.value) AS comment
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
JOIN sys.columns AS c ON c.object_id = o.object_id
JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
LEFT JOIN sys.extended_properties AS ep
  ON ep.major_id = c.object_id
 AND ep.minor_id = c.column_id
 AND ep.name = N'MS_Description'
WHERE s.name = @P1
  AND o.type IN (N'U', N'V')
  AND o.is_ms_shipped = 0
ORDER BY o.name, c.column_id";

pub(super) const TABLE_PRIMARY_KEYS_SQL: &str = "\
SELECT c.name
FROM sys.indexes AS i
JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.tables AS t ON t.object_id = i.object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE s.name = @P1
  AND t.name = @P2
  AND i.is_primary_key = 1
ORDER BY ic.key_ordinal";

pub(super) const TABLE_FOREIGN_KEYS_SQL: &str = "\
SELECT pc.name AS parent_column,
       rs.name AS reference_schema,
       rt.name AS reference_table,
       rc.name AS reference_column
FROM sys.foreign_key_columns AS fkc
JOIN sys.foreign_keys AS fk ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables AS pt ON pt.object_id = fkc.parent_object_id
JOIN sys.schemas AS ps ON ps.schema_id = pt.schema_id
JOIN sys.columns AS pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables AS rt ON rt.object_id = fkc.referenced_object_id
JOIN sys.schemas AS rs ON rs.schema_id = rt.schema_id
JOIN sys.columns AS rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE ps.name = @P1
  AND pt.name = @P2
ORDER BY fk.name, fkc.constraint_column_id";

pub(super) const SCHEMA_PRIMARY_KEYS_SQL: &str = "\
SELECT t.name AS table_name,
       c.name AS column_name
FROM sys.indexes AS i
JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.tables AS t ON t.object_id = i.object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE s.name = @P1
  AND i.is_primary_key = 1
ORDER BY t.name, ic.key_ordinal";

pub(super) const SCHEMA_FOREIGN_KEYS_SQL: &str = "\
SELECT pt.name AS parent_table,
       pc.name AS parent_column,
       rs.name AS reference_schema,
       rt.name AS reference_table,
       rc.name AS reference_column
FROM sys.foreign_key_columns AS fkc
JOIN sys.foreign_keys AS fk ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables AS pt ON pt.object_id = fkc.parent_object_id
JOIN sys.schemas AS ps ON ps.schema_id = pt.schema_id
JOIN sys.columns AS pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables AS rt ON rt.object_id = fkc.referenced_object_id
JOIN sys.schemas AS rs ON rs.schema_id = rt.schema_id
JOIN sys.columns AS rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE ps.name = @P1
ORDER BY pt.name, fk.name, fkc.constraint_column_id";

pub(super) const TABLE_CHECKS_SQL: &str = "\
SELECT c.name AS column_name,
       cc.definition
FROM sys.check_constraints AS cc
JOIN sys.tables AS t ON t.object_id = cc.parent_object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
LEFT JOIN sys.columns AS c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE s.name = @P1
  AND t.name = @P2
ORDER BY cc.name";

pub(super) const SCHEMA_CHECKS_SQL: &str = "\
SELECT t.name AS table_name,
       c.name AS column_name,
       cc.definition
FROM sys.check_constraints AS cc
JOIN sys.tables AS t ON t.object_id = cc.parent_object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
LEFT JOIN sys.columns AS c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE s.name = @P1
ORDER BY t.name, cc.name";

pub(super) const INDEXES_SQL: &str = "\
SELECT i.name AS index_name,
       c.name AS column_name,
       i.type_desc,
       i.is_unique,
       i.is_primary_key,
       ic.key_ordinal
FROM sys.indexes AS i
JOIN sys.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
JOIN sys.tables AS t ON t.object_id = i.object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
WHERE s.name = @P1
  AND t.name = @P2
  AND i.index_id > 0
  AND i.is_hypothetical = 0
ORDER BY i.name, ic.key_ordinal, ic.index_column_id";

pub(super) const CONSTRAINTS_SQL: &str = "\
SELECT kc.name AS constraint_name,
       CASE kc.type WHEN N'PK' THEN N'PRIMARY KEY' ELSE N'UNIQUE' END AS constraint_type,
       c.name AS column_name,
       CAST(NULL AS NVARCHAR(128)) AS reference_table,
       CAST(NULL AS NVARCHAR(128)) AS reference_column,
       ic.key_ordinal AS ordinal
FROM sys.key_constraints AS kc
JOIN sys.tables AS t ON t.object_id = kc.parent_object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
JOIN sys.index_columns AS ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
JOIN sys.columns AS c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE s.name = @P1
  AND t.name = @P2
UNION ALL
SELECT fk.name AS constraint_name,
       N'FOREIGN KEY' AS constraint_type,
       pc.name AS column_name,
       rt.name AS reference_table,
       rc.name AS reference_column,
       fkc.constraint_column_id AS ordinal
FROM sys.foreign_key_columns AS fkc
JOIN sys.foreign_keys AS fk ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables AS pt ON pt.object_id = fkc.parent_object_id
JOIN sys.schemas AS ps ON ps.schema_id = pt.schema_id
JOIN sys.columns AS pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables AS rt ON rt.object_id = fkc.referenced_object_id
JOIN sys.columns AS rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE ps.name = @P1
  AND pt.name = @P2
UNION ALL
SELECT cc.name AS constraint_name,
       N'CHECK' AS constraint_type,
       c.name AS column_name,
       CAST(NULL AS NVARCHAR(128)) AS reference_table,
       CAST(NULL AS NVARCHAR(128)) AS reference_column,
       1 AS ordinal
FROM sys.check_constraints AS cc
JOIN sys.tables AS t ON t.object_id = cc.parent_object_id
JOIN sys.schemas AS s ON s.schema_id = t.schema_id
LEFT JOIN sys.columns AS c ON c.object_id = cc.parent_object_id AND c.column_id = cc.parent_column_id
WHERE s.name = @P1
  AND t.name = @P2
ORDER BY constraint_name, ordinal";

pub(super) const ROUTINES_SQL: &str = "\
SELECT o.object_id,
       o.name,
       CASE WHEN o.type = N'P' THEN N'procedure' ELSE N'function' END AS kind,
       CASE WHEN o.type = N'P' THEN NULL ELSE ret_type.name END AS return_type,
       OBJECT_DEFINITION(o.object_id) AS source
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
LEFT JOIN sys.parameters AS ret ON ret.object_id = o.object_id AND ret.parameter_id = 0
LEFT JOIN sys.types AS ret_type ON ret_type.user_type_id = ret.user_type_id
WHERE s.name = @P1
  AND o.type IN (N'P', N'FN', N'IF', N'TF', N'FS', N'FT')
  AND o.is_ms_shipped = 0
ORDER BY o.name";

pub(super) const ROUTINE_PARAMS_SQL: &str = "\
SELECT o.name AS routine_name,
       p.name AS parameter_name,
       CASE
         WHEN ty.name IN (N'varchar', N'char', N'varbinary', N'binary') THEN
           ty.name + N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(NVARCHAR(16), p.max_length) END + N')'
         WHEN ty.name IN (N'nvarchar', N'nchar') THEN
           ty.name + N'(' + CASE WHEN p.max_length = -1 THEN N'max' ELSE CONVERT(NVARCHAR(16), p.max_length / 2) END + N')'
         WHEN ty.name IN (N'decimal', N'numeric') THEN
           ty.name + N'(' + CONVERT(NVARCHAR(16), p.precision) + N',' + CONVERT(NVARCHAR(16), p.scale) + N')'
         WHEN ty.name IN (N'datetime2', N'datetimeoffset', N'time') THEN
           ty.name + N'(' + CONVERT(NVARCHAR(16), p.scale) + N')'
         ELSE ty.name
       END AS data_type,
       p.is_output,
       p.parameter_id
FROM sys.parameters AS p
JOIN sys.objects AS o ON o.object_id = p.object_id
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
JOIN sys.types AS ty ON ty.user_type_id = p.user_type_id
WHERE s.name = @P1
  AND o.type IN (N'P', N'FN', N'IF', N'TF', N'FS', N'FT')
  AND o.is_ms_shipped = 0
  AND p.parameter_id > 0
ORDER BY o.name, p.parameter_id";

pub(super) const ROUTINE_SOURCE_SQL: &str = "\
SELECT OBJECT_DEFINITION(o.object_id) AS source
FROM sys.objects AS o
JOIN sys.schemas AS s ON s.schema_id = o.schema_id
WHERE s.name = @P1
  AND o.name = @P2
  AND o.type IN (N'P', N'FN', N'IF', N'TF', N'FS', N'FT')
  AND o.is_ms_shipped = 0";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_catalog_queries_keep_user_object_filters() {
        for sql in [
            TABLES_SQL,
            VIEWS_SQL,
            SCHEMA_COLUMNS_SQL,
            ROUTINES_SQL,
            ROUTINE_PARAMS_SQL,
        ] {
            assert!(sql.contains("s.name = @P1"));
            assert!(sql.contains("is_ms_shipped = 0"));
            assert!(sql.contains("ORDER BY"));
        }
    }

    #[test]
    fn object_catalog_queries_keep_schema_and_object_parameters() {
        for sql in [
            VIEW_DEFINITION_SQL,
            OBJECT_COLUMNS_SQL,
            TABLE_PRIMARY_KEYS_SQL,
            TABLE_FOREIGN_KEYS_SQL,
            TABLE_CHECKS_SQL,
            INDEXES_SQL,
            CONSTRAINTS_SQL,
            ROUTINE_SOURCE_SQL,
        ] {
            assert!(sql.contains("@P1"));
            assert!(sql.contains("@P2"));
        }
    }

    #[test]
    fn relationship_queries_keep_workbench_metadata_shape() {
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("parent_column"));
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("reference_schema"));
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("reference_table"));
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("reference_column"));
        assert!(SCHEMA_FOREIGN_KEYS_SQL.contains("parent_table"));
        assert!(SCHEMA_FOREIGN_KEYS_SQL.contains("reference_column"));
        assert!(CONSTRAINTS_SQL.contains("constraint_name"));
        assert!(CONSTRAINTS_SQL.contains("constraint_type"));
        assert!(INDEXES_SQL.contains("index_name"));
        assert!(INDEXES_SQL.contains("key_ordinal"));
    }

    // Bug: SQL Server auto-creates one schema per fixed database role
    // (`db_datareader`, `db_owner`, …) plus a `guest` schema. The old filter only
    // hid `sys`/`INFORMATION_SCHEMA`, so those role/`guest` schemas leaked into the
    // sidebar. They must be excluded while real user schemas (`dbo`, custom) stay.
    #[test]
    fn user_schemas_query_hides_fixed_role_and_guest_schemas() {
        const HIDDEN: &[&str] = &[
            "sys",
            "INFORMATION_SCHEMA",
            "db_accessadmin",
            "db_backupoperator",
            "db_datareader",
            "db_datawriter",
            "db_ddladmin",
            "db_denydatareader",
            "db_denydatawriter",
            "db_owner",
            "db_securityadmin",
            "guest",
        ];
        for name in HIDDEN {
            assert!(
                USER_SCHEMAS_SQL.contains(&format!("N'{name}'")),
                "USER_SCHEMAS_SQL must exclude system/role schema `{name}`"
            );
        }
        // User schemas are never hardcoded into the exclusion list.
        for name in ["dbo", "sales", "hr"] {
            assert!(
                !USER_SCHEMAS_SQL.contains(&format!("N'{name}'")),
                "USER_SCHEMAS_SQL must not exclude user schema `{name}`"
            );
        }
    }

    #[test]
    fn database_and_current_catalog_queries_keep_sql_server_contract() {
        assert!(USER_SCHEMAS_SQL.contains("INFORMATION_SCHEMA"));
        assert!(USER_DATABASES_SQL.contains("state_desc = N'ONLINE'"));
        assert!(USER_DATABASES_SQL.contains("HAS_DBACCESS(d.name) = 1"));
        assert_eq!(CURRENT_DATABASE_SQL, "SELECT DB_NAME()");
    }
}
