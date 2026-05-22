-- Sprint 452 — user-managed SQLite DBMS file contract.
-- This column belongs to user connection metadata, not internal app state.
ALTER TABLE connections ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0;
