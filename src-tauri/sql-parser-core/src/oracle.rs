//! Issue #1351 — Oracle-dialect Safe Mode danger classifier.
//!
//! The shared [`crate::safety`] classifier is dialect-agnostic: it never
//! sees Oracle PL/SQL blocks (`BEGIN … END;`, `DECLARE …`), the `EXEC` /
//! `EXECUTE IMMEDIATE` / `CALL` routine paths, or admin DDL
//! (`ALTER SYSTEM`, `DROP USER`, `AUDIT`, …). The frontend blocks all of
//! these (`src/lib/sql/oracleSafety.ts` `UNSUPPORTED_ORACLE_PATTERNS` +
//! the bounded-CREATE slice), but before this module the Tauri backend
//! gate classified them as `Info` — a direct IPC `invoke` on an Oracle
//! connection ran `BEGIN EXECUTE IMMEDIATE 'DROP TABLE payroll'; END;`
//! unconfirmed even in strict + production.
//!
//! This is the native port of the frontend Oracle danger set so the two
//! project the SAME verdict (consistency principle: same risk = same
//! judgment). It is layered ON TOP of [`crate::safety::is_danger`]: the
//! generic danger set (DROP TABLE, WHERE-less DELETE, …) still applies to
//! Oracle; this module only adds the Oracle-specific hazards the AST/keyword
//! scan misses.
//!
//! Danger set (mirrors `oracleSafety.ts`):
//!   - PL/SQL: leading `DECLARE` / `BEGIN` / `EXEC` / `EXECUTE` / `CALL`
//!   - admin ALTER: `ALTER SYSTEM|SESSION|DATABASE|USER|ROLE|TABLESPACE|
//!     PROFILE|DISKGROUP|PLUGGABLE DATABASE`
//!   - admin DROP: `DROP USER|ROLE|TABLESPACE|PROFILE|DIRECTORY|
//!     PLUGGABLE DATABASE|DATABASE LINK|PUBLIC DATABASE LINK`
//!   - admin maintenance: leading `AUDIT|NOAUDIT|ANALYZE|FLASHBACK|PURGE`
//!   - bounded-CREATE slice: any `CREATE` that is NOT
//!     `CREATE [GLOBAL TEMPORARY] TABLE` / `CREATE [UNIQUE|BITMAP] INDEX` /
//!     `CREATE [OR REPLACE] VIEW` (this single rule subsumes CREATE PACKAGE /
//!     PROCEDURE / FUNCTION / TRIGGER / TYPE / USER / ROLE / SEQUENCE /
//!     SYNONYM / MATERIALIZED VIEW / DATABASE LINK / DIRECTORY …).
//!
//! GRANT / REVOKE are intentionally NOT here — issue #1120 moved them to
//! warn-tier permission changes across all dialects, so the shared
//! classifier's `Warn` is the correct parity verdict.

/// True when any statement in `sql` is an Oracle-specific danger the shared
/// dialect-agnostic classifier misses. The caller (`execute_query` gate)
/// ORs this with [`crate::safety::is_danger`] only for Oracle connections.
///
/// RED-evidence stub (issue #1351): returns `false` so the danger cases in
/// the tests below fail, documenting the fail-open hole before the fix.
pub fn is_oracle_danger(_sql: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::safety::{classify, is_danger, Severity};

    // --- The named #1351 security hole: PL/SQL blocks -------------------

    #[test]
    fn plsql_block_execute_immediate_is_danger() {
        // The exact repro from the issue — a PL/SQL block wrapping a dynamic
        // DROP. The shared classifier sees `Info`; Oracle must see danger.
        let sql = "BEGIN EXECUTE IMMEDIATE 'DROP TABLE payroll'; END;";
        assert!(!is_danger(sql), "shared classifier misses PL/SQL (documents the hole)");
        assert!(is_oracle_danger(sql));
    }

    #[test]
    fn plsql_declare_and_anonymous_blocks_are_danger() {
        assert!(is_oracle_danger("DECLARE v NUMBER; BEGIN NULL; END;"));
        assert!(is_oracle_danger("DECLARE BEGIN NULL; END;"));
        assert!(is_oracle_danger("BEGIN dbms_output.put_line('x'); END;"));
    }

    #[test]
    fn exec_execute_call_routine_paths_are_danger() {
        assert!(is_oracle_danger("EXEC my_proc(1)"));
        assert!(is_oracle_danger("EXECUTE my_proc"));
        assert!(is_oracle_danger("CALL my_proc()"));
    }

    #[test]
    fn plsql_routine_ddl_is_danger() {
        assert!(is_oracle_danger("CREATE OR REPLACE PACKAGE app_pkg AS END app_pkg;"));
        assert!(is_oracle_danger("CREATE PACKAGE BODY app_pkg AS END;"));
        assert!(is_oracle_danger("CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;"));
        assert!(is_oracle_danger("CREATE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;"));
        assert!(is_oracle_danger("CREATE OR REPLACE TRIGGER trg BEFORE INSERT ON t BEGIN NULL; END;"));
        assert!(is_oracle_danger("CREATE TYPE BODY t AS END;"));
        // Editionable variants the frontend regex allows.
        assert!(is_oracle_danger("CREATE EDITIONABLE PACKAGE p AS END;"));
        assert!(is_oracle_danger("CREATE NONEDITIONABLE PROCEDURE p AS BEGIN NULL; END;"));
    }

    // --- Admin DDL ------------------------------------------------------

    #[test]
    fn admin_alter_is_danger() {
        for sql in [
            "ALTER SYSTEM SET processes = 300",
            "ALTER SESSION SET CURRENT_SCHEMA = HR",
            "ALTER DATABASE OPEN",
            "ALTER USER app ACCOUNT LOCK",
            "ALTER ROLE app_role IDENTIFIED BY x",
            "ALTER TABLESPACE app_data OFFLINE",
            "ALTER PROFILE app LIMIT SESSIONS_PER_USER 3",
            "ALTER PLUGGABLE DATABASE pdb1 CLOSE",
        ] {
            assert!(is_oracle_danger(sql), "{sql}");
        }
    }

    #[test]
    fn admin_create_is_danger() {
        for sql in [
            "CREATE USER app IDENTIFIED BY secret",
            "CREATE ROLE app_role",
            "CREATE TABLESPACE app_data DATAFILE 'app.dbf' SIZE 10M",
            "CREATE PROFILE app LIMIT SESSIONS_PER_USER 3",
            "CREATE DIRECTORY dp_dir AS '/tmp'",
            "CREATE PUBLIC DATABASE LINK dl CONNECT TO u IDENTIFIED BY p USING 'x'",
            "CREATE DATABASE LINK dl CONNECT TO u IDENTIFIED BY p USING 'x'",
            "CREATE PLUGGABLE DATABASE pdb2 ADMIN USER a IDENTIFIED BY p",
        ] {
            assert!(is_oracle_danger(sql), "{sql}");
        }
    }

    #[test]
    fn admin_drop_is_danger() {
        for sql in [
            "DROP USER app CASCADE",
            "DROP ROLE app_role",
            "DROP TABLESPACE app_data INCLUDING CONTENTS",
            "DROP PROFILE app",
            "DROP DIRECTORY dp_dir",
            "DROP PUBLIC DATABASE LINK dl",
            "DROP DATABASE LINK dl",
            "DROP PLUGGABLE DATABASE pdb2 INCLUDING DATAFILES",
        ] {
            assert!(is_oracle_danger(sql), "{sql}");
        }
    }

    #[test]
    fn admin_maintenance_is_danger() {
        assert!(is_oracle_danger("AUDIT SELECT ON app.orders"));
        assert!(is_oracle_danger("NOAUDIT SELECT ON app.orders"));
        assert!(is_oracle_danger("ANALYZE TABLE t COMPUTE STATISTICS"));
        assert!(is_oracle_danger("FLASHBACK TABLE t TO TIMESTAMP x"));
        assert!(is_oracle_danger("PURGE DBA_RECYCLEBIN"));
    }

    #[test]
    fn non_table_index_view_create_is_danger() {
        // Bounded-CREATE slice: the frontend blocks these as outside the
        // supported DDL slice; the backend gate now matches.
        for sql in [
            "CREATE SEQUENCE account_seq START WITH 1",
            "CREATE SYNONYM account_alias FOR accounts",
            "CREATE MATERIALIZED VIEW account_mv AS SELECT * FROM accounts",
        ] {
            assert!(is_oracle_danger(sql), "{sql}");
        }
    }

    // --- False-positive guards (supported Oracle SQL stays non-danger) --

    #[test]
    fn supported_create_slice_is_not_oracle_danger() {
        for sql in [
            "CREATE TABLE accounts (id NUMBER(10), name VARCHAR2(80), notes CLOB)",
            "CREATE GLOBAL TEMPORARY TABLE tmp (id NUMBER)",
            "CREATE INDEX idx_accounts_name ON accounts (name)",
            "CREATE UNIQUE INDEX uq ON accounts (id)",
            "CREATE BITMAP INDEX bx ON accounts (status)",
            "CREATE VIEW v AS SELECT * FROM accounts",
            "CREATE OR REPLACE VIEW v AS SELECT * FROM accounts",
        ] {
            assert!(!is_oracle_danger(sql), "{sql} must not be Oracle-danger");
        }
    }

    #[test]
    fn begin_as_literal_or_identifier_is_not_danger() {
        // `BEGIN` inside a string literal / as a column name must not trip
        // the PL/SQL anchor — the statement's leading token is SELECT.
        assert!(!is_oracle_danger("SELECT 'BEGIN' AS note FROM dual"));
        assert!(!is_oracle_danger("SELECT begin_date FROM shifts"));
        assert!(!is_oracle_danger("SELECT * FROM dual"));
    }

    #[test]
    fn normal_oracle_dml_keeps_shared_severity() {
        // These are handled by the shared classifier; Oracle adds nothing.
        assert!(!is_oracle_danger("UPDATE accounts SET status = 'closed' WHERE id = 1"));
        assert!(!is_oracle_danger("INSERT INTO audit_log (id) VALUES (1)"));
        assert!(!is_oracle_danger("SELECT * FROM accounts WHERE id = 1"));
        // ALTER TABLE / DROP TABLE are the shared classifier's job, not this
        // module's — it must not double-classify or mis-flag ALTER TABLE ADD.
        assert!(!is_oracle_danger("ALTER TABLE accounts ADD (archived NUMBER)"));
    }

    #[test]
    fn grant_revoke_stay_out_of_oracle_danger() {
        // Issue #1120 parity — permission changes are warn, never danger.
        assert!(!is_oracle_danger("GRANT DBA TO app"));
        assert!(!is_oracle_danger("REVOKE SELECT ON t FROM app"));
    }

    #[test]
    fn hidden_trailing_admin_ddl_is_caught() {
        // A leading read must not shield a trailing admin DROP.
        assert!(is_oracle_danger("SELECT 1 FROM dual; DROP USER hr CASCADE"));
        // …but the same tokens inside a string literal are inert.
        assert!(!is_oracle_danger("SELECT '; DROP USER hr' AS note FROM dual"));
    }

    #[test]
    fn shared_danger_still_applies_to_oracle_via_generic_classifier() {
        // Sanity: the generic classifier already gates these for Oracle, so
        // the gate's OR still fires even though this module returns false.
        assert_eq!(classify("DROP TABLE payroll"), Severity::Danger);
        assert_eq!(classify("DELETE FROM payroll"), Severity::Danger);
    }
}
