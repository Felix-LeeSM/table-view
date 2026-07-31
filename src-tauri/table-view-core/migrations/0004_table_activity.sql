-- #1218 — table-level pin + recent-usage record.
--
-- Tracks individual tables (not connections like `mru`, not SQL queries like
-- `favorites`) so a heavily-populated schema tree can offer a "Pinned" /
-- "Recent" re-entry section. A single row can be both pinned and recent.
--
-- `schema_name` is `TEXT NOT NULL DEFAULT ''` rather than nullable so the
-- composite PRIMARY KEY dedupes correctly — SQLite treats each NULL in a PK as
-- distinct, which would let a schemaless (MySQL/SQLite) table upsert into
-- duplicate rows. The frontend maps '' <-> null across the IPC boundary.
CREATE TABLE IF NOT EXISTS table_activity (
    connection_id   TEXT NOT NULL,
    db_name         TEXT NOT NULL,
    schema_name     TEXT NOT NULL DEFAULT '',    -- '' = schemaless (null in frontend)
    table_name      TEXT NOT NULL,
    last_used       INTEGER,                     -- unix ms; NULL = pinned-only, never opened
    pinned_at       INTEGER,                     -- unix ms; NULL = not pinned
    PRIMARY KEY (connection_id, db_name, schema_name, table_name)
);
CREATE INDEX IF NOT EXISTS idx_table_activity_recent
    ON table_activity(connection_id, db_name, last_used DESC);
