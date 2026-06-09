# Refactor 02 raw Tauri invoke inventory

Issue: #733

Verification command:

```bash
rg -n "@tauri-apps/api/core|\binvoke(?:<[^>]+>)?\s*\(" src --glob '!src/lib/tauri/**' --glob '!**/*.test.ts' --glob '!**/*.test.tsx'
```

## Completed in #733

| Path | Commands | Owner | Wrapper target | Risk | Action |
|---|---|---|---|---|---|
| `src/lib/themeBoot.ts` | `get_setting` | theme boot reconcile | `src/lib/tauri/settings.ts` | low | Moved to `getSetting("theme")`. |
| `src/stores/themeStore.ts` | `persist_setting`, `get_setting` | theme settings store | `src/lib/tauri/settings.ts` | low | Moved to `persistSettingValue` and `getSetting`. |
| `src/stores/safeModeStore.ts` | `persist_setting`, `get_setting` | Safe Mode settings store | `src/lib/tauri/settings.ts` | low | Moved to `persistSettingValue` and `getSetting`. |
| `src/stores/historySettingsStore.ts` | `persist_setting`, `get_setting` | query-history settings store | `src/lib/tauri/settings.ts` | low | Moved to `persistSettingValue` and `getSetting`. |

## Remaining Triaged Sites

| Path | Commands | Owner | Wrapper target | Risk | Action |
|---|---|---|---|---|---|
| `src/stores/favoritesStore.ts` | `list_favorites`, `persist_favorites` | favorites persistence store | `src/lib/tauri/favorites.ts` | medium | Defer to query-domain follow-up under #737 or later. Static policy inventory prevents command drift. |
| `src/stores/mruStore.ts` | `persist_mru`, `clear_mru` | MRU persistence store | `src/lib/tauri/mru.ts` | low | Defer to workspace-shell follow-up under #740 or later. Static policy inventory prevents command drift. |
| `src/lib/keyringFallback.ts` | `set_keyring_fallback_dismissed` | connection keyring fallback UI | `src/lib/tauri/keyring.ts` | low | Defer to connection-domain follow-up under #735 or later. |
| `src/lib/window-controls.ts` | dynamic `*_show`, dynamic `*_hide`, dynamic `*_focus`, `workspace_ensure`, `workspace_show`, `workspace_close`, `app_exit` | launcher/workspace window shell | `src/lib/tauri/window.ts` | medium | Defer to workspace/window-shell follow-up under #740 or later; dynamic command names need a narrow typed facade. |
| `src/lib/scopedLocalStorage.ts` | `get_session_id` | session-scoped local storage | `src/lib/tauri/session.ts` | medium | Defer to session/runtime follow-up; boot fallback behavior should stay unchanged. |
| `src/lib/api/collectionStats.ts` | `collection_stats_rdb`, `collection_stats_mongo` | collection statistics API | `src/lib/tauri/collectionStats.ts` | medium | Defer to catalog/schema follow-up under #738 or later. |
| `src/lib/api/explain.ts` | `explain_rdb_query`, `explain_mongo_find` | query explain API | `src/lib/tauri/explain.ts` | medium | Defer to query-domain follow-up under #737 or later. |
| `src/lib/api/listDatabases.ts` | `list_databases` | database list API | `src/lib/tauri/databases.ts` | low | Defer to connection/catalog follow-up under #735/#738 or later. |
| `src/lib/api/serverActivity.ts` | `list_server_activity`, `kill_server_activity` | server activity API | `src/lib/tauri/serverOps.ts` | high | Defer to server-ops follow-up; `kill_server_activity` needs command-specific typing, not a generic wrapper. |
| `src/lib/api/serverInfo.ts` | `server_info` | server info API | `src/lib/tauri/serverInfo.ts` | low | Defer to connection-domain follow-up under #735 or later. |
| `src/lib/api/slowQueries.ts` | `slow_queries` | slow-query API | `src/lib/tauri/serverOps.ts` | low | Defer to server-ops follow-up. |
| `src/lib/api/switchActiveDb.ts` | `switch_active_db` | active database runtime API | `src/lib/tauri/activeDb.ts` | medium | Defer to connection/workspace follow-up under #735/#740 or later. |
| `src/lib/api/verifyActiveDb.ts` | `verify_active_db` | active database guard API | `src/lib/tauri/activeDb.ts` | medium | Defer to connection/workspace follow-up under #735/#740 or later. |

## Guard

`scripts/check-eslint-static-policy.ts` now fails on any production
`src/stores/**` raw `@tauri-apps/api/core` import unless it is listed in
`RAW_TAURI_INVOKE_INVENTORY` with exact command names.
