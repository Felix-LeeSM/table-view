-- ---------------------------------------------------------------------------
-- snippets — Saved SQL snippet/template bodies (#1528). Mirrors the favorites
-- table shape (0001_initial.sql) minus connection scoping: snippets are
-- global, reusable templates whose `{{placeholder}}` variables are
-- substituted on the frontend at insert time. Local-first; no sharing/cloud
-- sync. SQLite is the single SOT (same model favorites reached at W3).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snippets (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    body        TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);
