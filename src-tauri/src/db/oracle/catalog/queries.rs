pub(super) const CURRENT_DATABASE_SQL: &str = "SELECT SYS_CONTEXT('USERENV', 'CON_NAME') FROM DUAL";

pub(super) const CURRENT_SCHEMA_SQL: &str =
    "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM DUAL";

pub(super) const USER_SCHEMAS_SQL: &str = "\
SELECT DISTINCT owner
FROM all_objects
WHERE object_type IN (
    'TABLE', 'VIEW', 'SEQUENCE', 'PROCEDURE', 'FUNCTION',
    'PACKAGE', 'PACKAGE BODY', 'SYNONYM'
)
  AND owner NOT IN (
    'ANONYMOUS', 'APPQOSSYS', 'AUDSYS', 'CTXSYS', 'DBSFWUSER', 'DBSNMP',
    'DIP', 'DVF', 'DVSYS', 'GGSYS', 'GSMADMIN_INTERNAL', 'GSMCATUSER',
    'GSMROOTUSER', 'LBACSYS', 'MDSYS', 'OJVMSYS', 'OLAPSYS', 'ORDDATA',
    'ORDPLUGINS', 'ORDSYS', 'OUTLN', 'REMOTE_SCHEDULER_AGENT',
    'SI_INFORMTN_SCHEMA', 'SYS', 'SYSBACKUP', 'SYSDG', 'SYSKM', 'SYSRAC',
    'SYSTEM', 'WMSYS', 'XDB', 'XS$NULL'
  )
  AND owner NOT LIKE 'APEX_%'
  AND owner NOT LIKE 'FLOWS_%'
ORDER BY owner";

pub(super) const TABLES_SQL: &str = "\
SELECT table_name,
       num_rows
FROM all_tables
WHERE owner = :1
  AND nested = 'NO'
ORDER BY table_name";

pub(super) const VIEWS_SQL: &str = "\
SELECT view_name,
       NULL AS definition
FROM all_views
WHERE owner = :1
ORDER BY view_name";

pub(super) const VIEW_DEFINITION_SQL: &str = "\
SELECT text
FROM all_views
WHERE owner = :1
  AND view_name = :2";

pub(super) const OBJECT_COLUMNS_SQL: &str = "\
SELECT c.column_name,
       CASE
         WHEN c.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') THEN
           c.data_type || '(' || c.char_length ||
           CASE WHEN c.char_used = 'C' THEN ' CHAR' ELSE '' END || ')'
         WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN
           'NUMBER(' || c.data_precision ||
           CASE WHEN c.data_scale IS NOT NULL THEN ',' || c.data_scale ELSE '' END || ')'
         WHEN c.data_type LIKE 'TIMESTAMP%' AND c.data_scale IS NOT NULL THEN
           c.data_type || '(' || c.data_scale || ')'
         WHEN c.data_type LIKE 'INTERVAL DAY%' AND c.data_scale IS NOT NULL THEN
           c.data_type || '(' || c.data_scale || ')'
         WHEN c.data_type IN ('RAW', 'UROWID') AND c.data_length IS NOT NULL THEN
           c.data_type || '(' || c.data_length || ')'
         ELSE c.data_type
       END AS column_type,
       c.data_type,
       c.nullable,
       c.data_default,
       cc.comments
FROM all_tab_cols c
LEFT JOIN all_col_comments cc
  ON cc.owner = c.owner
 AND cc.table_name = c.table_name
 AND cc.column_name = c.column_name
WHERE c.owner = :1
  AND c.table_name = :2
  AND c.hidden_column = 'NO'
ORDER BY c.column_id";

pub(super) const SCHEMA_COLUMNS_SQL: &str = "\
SELECT c.table_name,
       c.column_name,
       CASE
         WHEN c.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') THEN
           c.data_type || '(' || c.char_length ||
           CASE WHEN c.char_used = 'C' THEN ' CHAR' ELSE '' END || ')'
         WHEN c.data_type = 'NUMBER' AND c.data_precision IS NOT NULL THEN
           'NUMBER(' || c.data_precision ||
           CASE WHEN c.data_scale IS NOT NULL THEN ',' || c.data_scale ELSE '' END || ')'
         WHEN c.data_type LIKE 'TIMESTAMP%' AND c.data_scale IS NOT NULL THEN
           c.data_type || '(' || c.data_scale || ')'
         WHEN c.data_type LIKE 'INTERVAL DAY%' AND c.data_scale IS NOT NULL THEN
           c.data_type || '(' || c.data_scale || ')'
         WHEN c.data_type IN ('RAW', 'UROWID') AND c.data_length IS NOT NULL THEN
           c.data_type || '(' || c.data_length || ')'
         ELSE c.data_type
       END AS column_type,
       c.data_type,
       c.nullable,
       c.data_default,
       cc.comments
FROM all_tab_cols c
LEFT JOIN all_col_comments cc
  ON cc.owner = c.owner
 AND cc.table_name = c.table_name
 AND cc.column_name = c.column_name
WHERE c.owner = :1
  AND c.hidden_column = 'NO'
ORDER BY c.table_name, c.column_id";

pub(super) const TABLE_PRIMARY_KEYS_SQL: &str = "\
SELECT cc.column_name
FROM all_constraints c
JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
WHERE c.owner = :1
  AND c.table_name = :2
  AND c.constraint_type = 'P'
ORDER BY cc.position";

pub(super) const TABLE_FOREIGN_KEYS_SQL: &str = "\
SELECT cc.column_name AS parent_column,
       rcc.owner AS reference_schema,
       rcc.table_name AS reference_table,
       rcc.column_name AS reference_column
FROM all_constraints c
JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
JOIN all_constraints rc
  ON rc.owner = c.r_owner
 AND rc.constraint_name = c.r_constraint_name
JOIN all_cons_columns rcc
  ON rcc.owner = rc.owner
 AND rcc.constraint_name = rc.constraint_name
 AND rcc.position = cc.position
WHERE c.owner = :1
  AND c.table_name = :2
  AND c.constraint_type = 'R'
ORDER BY c.constraint_name, cc.position";

pub(super) const SCHEMA_PRIMARY_KEYS_SQL: &str = "\
SELECT c.table_name,
       cc.column_name
FROM all_constraints c
JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
WHERE c.owner = :1
  AND c.constraint_type = 'P'
ORDER BY c.table_name, cc.position";

pub(super) const SCHEMA_FOREIGN_KEYS_SQL: &str = "\
SELECT c.table_name AS parent_table,
       cc.column_name AS parent_column,
       rcc.owner AS reference_schema,
       rcc.table_name AS reference_table,
       rcc.column_name AS reference_column
FROM all_constraints c
JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
JOIN all_constraints rc
  ON rc.owner = c.r_owner
 AND rc.constraint_name = c.r_constraint_name
JOIN all_cons_columns rcc
  ON rcc.owner = rc.owner
 AND rcc.constraint_name = rc.constraint_name
 AND rcc.position = cc.position
WHERE c.owner = :1
  AND c.constraint_type = 'R'
ORDER BY c.table_name, c.constraint_name, cc.position";

pub(super) const TABLE_CHECKS_SQL: &str = "\
SELECT cc.column_name,
       c.search_condition
FROM all_constraints c
LEFT JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
WHERE c.owner = :1
  AND c.table_name = :2
  AND c.constraint_type = 'C'
ORDER BY c.constraint_name, cc.position";

pub(super) const SCHEMA_CHECKS_SQL: &str = "\
SELECT c.table_name,
       cc.column_name,
       c.search_condition
FROM all_constraints c
LEFT JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
WHERE c.owner = :1
  AND c.constraint_type = 'C'
ORDER BY c.table_name, c.constraint_name, cc.position";

pub(super) const INDEXES_SQL: &str = "\
SELECT i.index_name,
       ic.column_name,
       i.index_type,
       CASE WHEN i.uniqueness = 'UNIQUE' THEN 'Y' ELSE 'N' END AS is_unique,
       CASE WHEN pk.constraint_name IS NULL THEN 'N' ELSE 'Y' END AS is_primary,
       ic.column_position
FROM all_indexes i
JOIN all_ind_columns ic
  ON ic.index_owner = i.owner
 AND ic.index_name = i.index_name
LEFT JOIN all_constraints pk
  ON pk.owner = i.owner
 AND pk.index_name = i.index_name
 AND pk.constraint_type = 'P'
WHERE i.owner = :1
  AND i.table_name = :2
ORDER BY i.index_name, ic.column_position";

pub(super) const CONSTRAINTS_SQL: &str = "\
SELECT c.constraint_name,
       CASE c.constraint_type
         WHEN 'P' THEN 'PRIMARY KEY'
         WHEN 'U' THEN 'UNIQUE'
         WHEN 'R' THEN 'FOREIGN KEY'
         WHEN 'C' THEN 'CHECK'
         ELSE c.constraint_type
       END AS constraint_type,
       cc.column_name,
       CASE
         WHEN c.constraint_type = 'R' THEN rcc.owner || '.' || rcc.table_name
         ELSE NULL
       END AS reference_table,
       rcc.column_name AS reference_column,
       cc.position
FROM all_constraints c
LEFT JOIN all_cons_columns cc
  ON cc.owner = c.owner
 AND cc.constraint_name = c.constraint_name
LEFT JOIN all_constraints rc
  ON rc.owner = c.r_owner
 AND rc.constraint_name = c.r_constraint_name
LEFT JOIN all_cons_columns rcc
  ON rcc.owner = rc.owner
 AND rcc.constraint_name = rc.constraint_name
 AND rcc.position = cc.position
WHERE c.owner = :1
  AND c.table_name = :2
  AND c.constraint_type IN ('P', 'U', 'R', 'C')
ORDER BY c.constraint_name, cc.position";

pub(super) const ROUTINES_SQL: &str = "\
SELECT o.object_name AS routine_name,
       LOWER(o.object_type) AS kind,
       (
         SELECT a.data_type
         FROM all_arguments a
         WHERE a.owner = o.owner
           AND a.package_name IS NULL
           AND a.object_name = o.object_name
           AND a.position = 0
           AND a.data_level = 0
           AND ROWNUM = 1
       ) AS return_type
FROM all_objects o
WHERE o.owner = :1
  AND o.object_type IN ('PROCEDURE', 'FUNCTION', 'PACKAGE')
ORDER BY o.object_name";

pub(super) const SEQUENCES_SQL: &str = "\
SELECT sequence_name,
       min_value,
       max_value,
       increment_by,
       cycle_flag,
       order_flag,
       cache_size,
       last_number
FROM all_sequences
WHERE sequence_owner = :1
ORDER BY sequence_name";

pub(super) const SYNONYMS_SQL: &str = "\
SELECT synonym_name,
       table_owner,
       table_name,
       db_link
FROM all_synonyms
WHERE owner = :1
ORDER BY synonym_name";

pub(super) const ROUTINE_PARAMS_SQL: &str = "\
SELECT a.object_name AS routine_name,
       a.argument_name,
       CASE
         WHEN a.data_type IN ('VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR') AND a.char_length IS NOT NULL THEN
           a.data_type || '(' || a.char_length || ')'
         WHEN a.data_type = 'NUMBER' AND a.data_precision IS NOT NULL THEN
           'NUMBER(' || a.data_precision ||
           CASE WHEN a.data_scale IS NOT NULL THEN ',' || a.data_scale ELSE '' END || ')'
         ELSE a.data_type
       END AS data_type,
       a.in_out,
       a.position
FROM all_arguments a
WHERE a.owner = :1
  AND a.package_name IS NULL
  AND a.position > 0
  AND a.data_level = 0
ORDER BY a.object_name, a.position";

pub(super) const ROUTINE_SOURCE_SQL: &str = "\
SELECT text
FROM all_source
WHERE owner = :1
  AND name = :2
  AND (:3 = '%' OR type = :3)
  AND (:3 != '%' OR type IN ('PROCEDURE', 'FUNCTION', 'PACKAGE', 'PACKAGE BODY'))
ORDER BY line";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_catalog_queries_keep_visible_user_object_filters() {
        assert!(USER_SCHEMAS_SQL.contains("all_objects"));
        assert!(USER_SCHEMAS_SQL.contains("SEQUENCE"));
        assert!(USER_SCHEMAS_SQL.contains("SYNONYM"));
        assert!(USER_SCHEMAS_SQL.contains("owner NOT IN"));
        assert!(USER_SCHEMAS_SQL.contains("ORDER BY owner"));
    }

    #[test]
    fn object_catalog_queries_keep_owner_and_object_parameters() {
        for sql in [
            OBJECT_COLUMNS_SQL,
            VIEW_DEFINITION_SQL,
            TABLE_PRIMARY_KEYS_SQL,
            TABLE_FOREIGN_KEYS_SQL,
            TABLE_CHECKS_SQL,
            INDEXES_SQL,
            CONSTRAINTS_SQL,
        ] {
            assert!(sql.contains(":1"));
            assert!(sql.contains(":2"));
        }
    }

    #[test]
    fn relationship_queries_keep_workbench_metadata_shape() {
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("parent_column"));
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("reference_schema"));
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("reference_table"));
        assert!(TABLE_FOREIGN_KEYS_SQL.contains("reference_column"));
        assert!(SCHEMA_FOREIGN_KEYS_SQL.contains("parent_table"));
        assert!(CONSTRAINTS_SQL.contains("constraint_name"));
        assert!(CONSTRAINTS_SQL.contains("constraint_type"));
        assert!(INDEXES_SQL.contains("index_name"));
        assert!(INDEXES_SQL.contains("column_position"));
    }

    #[test]
    fn routine_queries_keep_oracle_scope_without_executable_plsql_claim() {
        assert!(ROUTINES_SQL.contains("PROCEDURE"));
        assert!(ROUTINES_SQL.contains("FUNCTION"));
        assert!(ROUTINES_SQL.contains("PACKAGE"));
        assert!(ROUTINE_PARAMS_SQL.contains("all_arguments"));
        assert!(ROUTINE_SOURCE_SQL.contains("all_source"));
    }

    #[test]
    fn sequence_and_synonym_queries_keep_read_only_metadata_scope() {
        assert!(SEQUENCES_SQL.contains("all_sequences"));
        assert!(SEQUENCES_SQL.contains("sequence_owner = :1"));
        assert!(SEQUENCES_SQL.contains("last_number"));
        assert!(SYNONYMS_SQL.contains("all_synonyms"));
        assert!(SYNONYMS_SQL.contains("owner = :1"));
        assert!(SYNONYMS_SQL.contains("db_link"));
    }

    #[test]
    fn current_identity_queries_use_low_privilege_context() {
        assert_eq!(
            CURRENT_DATABASE_SQL,
            "SELECT SYS_CONTEXT('USERENV', 'CON_NAME') FROM DUAL"
        );
        assert_eq!(
            CURRENT_SCHEMA_SQL,
            "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') FROM DUAL"
        );
    }
}
