-- Sprint 355 (Phase 1) — initial SQLite schema for state-management
-- 이주 (strategy doc 2026-05-15).
--
-- 9 tables total:
--   - 8 domain: connections, connection_groups, workspaces, mru, settings,
--               query_history, favorites, datagrid_column_prefs
--   - 1 infra:  meta (key-value, including legacy_imported sentinel)
--
-- 본 migration 은 dual-write / dual-read 의 **토대** — Phase 1 머지 시점에는
-- file/LS 가 여전히 SOT 이고 SQLite 는 side channel. 이후 phase 에서 path
-- 전환.

-- ---------------------------------------------------------------------------
-- connections — strategy line 1156 (LegacyPayload shape) + models/connection.rs.
-- Encrypted password ciphertext (post-Q22 keyring 이주 시점에는 keyring 이
-- SOT 가 되지만, schema 자체는 그대로 — `password_enc` 컬럼이 빈 문자열).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connections (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL UNIQUE,
    db_type             TEXT NOT NULL,           -- 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | ...
    host                TEXT NOT NULL,
    port                INTEGER NOT NULL,
    user                TEXT NOT NULL,
    password_enc        TEXT NOT NULL DEFAULT '', -- 항상 ciphertext (또는 '' = 패스워드 없음). plaintext 금지.
    database            TEXT NOT NULL,
    group_id            TEXT,
    color               TEXT,
    connection_timeout  INTEGER,
    keep_alive_interval INTEGER,
    environment         TEXT,
    auth_source         TEXT,
    replica_set         TEXT,
    tls_enabled         INTEGER,                 -- 0/1, NULL = 미설정
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connections_group_id ON connections(group_id);

-- ---------------------------------------------------------------------------
-- connection_groups — Q20.3 `collapsed` boolean 추가. models/connection.rs:179.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS connection_groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT,
    collapsed   INTEGER NOT NULL DEFAULT 0,      -- BOOLEAN: 0 = expanded, 1 = collapsed
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- workspaces — Q13 PK (connection_id, db_name) + 3 JSON columns (tabs /
-- sidebar_expanded / closed_tabs). Strategy line 615–632.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
    connection_id         TEXT NOT NULL,
    db_name               TEXT NOT NULL,
    active_tab_id         TEXT,
    tabs_json             TEXT NOT NULL DEFAULT '[]',
    sidebar_expanded_json TEXT NOT NULL DEFAULT '[]',
    closed_tabs_json      TEXT NOT NULL DEFAULT '[]',
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (connection_id, db_name)
);

-- ---------------------------------------------------------------------------
-- mru — Most-Recently-Used connections. cap 5. mruStore.ts:29.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mru (
    connection_id   TEXT PRIMARY KEY,
    last_used       INTEGER NOT NULL              -- unix ms
);
CREATE INDEX IF NOT EXISTS idx_mru_last_used ON mru(last_used DESC);

-- ---------------------------------------------------------------------------
-- settings — key-value (theme / safe_mode / sidebar_width / home_recent_collapsed
-- / query_history_retention_days / query_history_enabled). Strategy line 650–664.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value_json  TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- ---------------------------------------------------------------------------
-- query_history — Q13 + codex 6차 #2 (query_mode 추가, workspace_id 컬럼 / index
-- 제거). Strategy line 535–562.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS query_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id   TEXT NOT NULL,
    tab_id          TEXT,
    paradigm        TEXT NOT NULL,              -- 'rdb' | 'document'
    query_mode      TEXT NOT NULL,              -- 'sql' | 'find' | ...
    database        TEXT,
    collection      TEXT,
    source          TEXT NOT NULL,              -- 'raw' | 'grid-edit' | ...
    sql             TEXT NOT NULL,
    sql_redacted    TEXT NOT NULL,
    status          TEXT NOT NULL,              -- 'success' | 'error' | 'cancelled'
    error_message   TEXT,
    rows_affected   INTEGER,
    duration_ms     INTEGER NOT NULL,
    executed_at     INTEGER NOT NULL,
    server_pid      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_history_connection_executed
    ON query_history(connection_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_tab
    ON query_history(tab_id) WHERE tab_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- favorites — Saved queries. favoritesStore.ts:25.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS favorites (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    sql             TEXT NOT NULL,
    connection_id   TEXT,                       -- NULL = global (any connection)
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_favorites_connection ON favorites(connection_id);

-- ---------------------------------------------------------------------------
-- datagrid_column_prefs — Q20.4 + Q20.5 (codex 7차 #2 — PK 5-tuple).
-- Strategy line 671–685.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS datagrid_column_prefs (
    connection_id       TEXT NOT NULL,
    paradigm            TEXT NOT NULL,          -- 'rdb' | 'document'
    db_name             TEXT NOT NULL,
    namespace           TEXT NOT NULL,
    table_name          TEXT NOT NULL,
    widths_json         TEXT NOT NULL DEFAULT '{}',
    hidden_columns_json TEXT NOT NULL DEFAULT '[]',
    updated_at          INTEGER NOT NULL,
    PRIMARY KEY (connection_id, paradigm, db_name, namespace, table_name)
);

-- ---------------------------------------------------------------------------
-- meta — key-value sentinels. Strategy line 1184 `legacy_imported` 4-state:
--   pending | importing | done | failed.
--
-- Fresh install 의 default = 'pending'. Frontend 가 LS read 후 IPC 호출 시
-- `pending → importing` 으로 전이, 완료 후 `done` 또는 `failed`.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL
);

INSERT OR IGNORE INTO meta(key, value) VALUES ('legacy_imported', 'pending');
INSERT OR IGNORE INTO meta(key, value) VALUES ('last_legacy_import_at', '');
