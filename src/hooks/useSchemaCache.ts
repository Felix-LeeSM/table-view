import { useCallback, useEffect, useRef, useState } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import { toast } from "@/lib/runtime/toast";
import i18n from "@lib/i18n";
import { logger } from "@/lib/logger";
import type { SchemaInfo } from "@/types/schema";

/**
 * SchemaTree 의 데이터 레이어 hook. schema/table/view/function 로딩과 캐시
 * 무효화를 담당해 컴포넌트는 순수 트리 렌더링에 집중한다.
 *
 * Sprint 263 — 캐시 키가 `(connId, db)` 별로 분리되어, 같은 connection 의
 * db1 ↔ db2 toggle 시 캐시가 재사용된다. 호출처는 `db` 를 명시적으로
 * 전달 — DB-aware 한 데이터 경로의 단일 source.
 *
 * 책임:
 * - mount 시 자동 `loadSchemas`. `(connId, db)` 별로 1회만.
 * - #1219 — schema 수가 `EAGER_SCHEMA_LOAD_THRESHOLD` 이하면 mount 시 모든
 *   schema 의 `loadTables` / `prefetchSchemaColumns` 를 즉시 발사(소규모 DB
 *   체감 유지). 초과하면 그 루프를 건너뛰고, 펼쳐진 schema 만 `expandSchema`
 *   로 lazy load (SchemaTree 의 reconciliation 효과가 구동).
 * - no-schema workbench(MySQL/MariaDB) 호출처는 mount 시 views/functions 도
 *   같이 로드한다. schema row 가 숨겨져 lazy expand 진입점이 없기 때문
 *   (`autoLoadAuxiliaryCatalog` = 항상 eager).
 * - schema 한 개 단위 lazy expand (`expandSchema`) — 캐시 미존재 시에만
 *   tables/views/functions + columns(prefetch) load.
 * - 전체 / 단일 schema refresh (`refreshConnection`, `refreshSchema`).
 * - silent failure 를 toast.error + dev console 로 일원화.
 *
 * 책임 외:
 * - 트리 UI state (expanded / selected / search) 는 컴포넌트가 보유 +
 *   Sprint 262 부터 `workspaceStore.sidebar` axis 에 위임.
 * - dropTable / renameTable 등 사용자 액션 catch 는 컴포넌트 layer 가
 *   처리.
 */

const EMPTY_SCHEMAS: SchemaInfo[] = [];

/**
 * #1219 — at or below this many schemas the mount-time eager per-schema loop
 * (loadTables + prefetchSchemaColumns per schema = N+1 IPC) is cheap enough
 * that loading everything up front keeps small DBs feeling instant (AC-3).
 * Above it the loop dominates first paint on wide catalogs, so those DBs load
 * only the expanded schemas (the first-schema seed + any persisted
 * `SidebarState.expanded`) lazily through `expandSchema`.
 */
export const EAGER_SCHEMA_LOAD_THRESHOLD = 5;

/**
 * No-schema (MySQL/MariaDB) / MSSQL / Oracle hide the schema row, so they have
 * no lazy `expandSchema` entry point — they must eager-load regardless of the
 * threshold (`autoLoadAuxiliaryCatalog`). In practice these carry a single
 * implicit schema, so the eager cost is trivial anyway.
 */
export function shouldEagerLoadSchemas(
  schemaCount: number,
  autoLoadAuxiliaryCatalog: boolean,
): boolean {
  return autoLoadAuxiliaryCatalog || schemaCount <= EAGER_SCHEMA_LOAD_THRESHOLD;
}

function logSchemaError(label: string, err: unknown): void {
  logger.error(`[useSchemaCache] ${label}:`, err);
}

export interface UseSchemaCacheReturn {
  schemas: SchemaInfo[];
  loadingSchemas: boolean;
  loadingTables: ReadonlySet<string>;
  refreshConnection(): void;
  refreshSchema(schemaName: string): void;
  expandSchema(schemaName: string): Promise<void>;
}

export interface UseSchemaCacheOptions {
  autoLoadAuxiliaryCatalog?: boolean;
  autoLoadFileAnalyticsSources?: boolean;
  clearFileAnalyticsSourcesOnRefresh?: boolean;
}

export function useSchemaCache(
  connectionId: string,
  db: string,
  options: UseSchemaCacheOptions = {},
): UseSchemaCacheReturn {
  const autoLoadAuxiliaryCatalog = options.autoLoadAuxiliaryCatalog === true;
  const autoLoadFileAnalyticsSources =
    options.autoLoadFileAnalyticsSources === true;
  const clearFileAnalyticsSourcesOnRefresh =
    options.clearFileAnalyticsSourcesOnRefresh === true;
  const schemas =
    useSchemaStore((s) => s.schemas[connectionId]?.[db]) ?? EMPTY_SCHEMAS;
  const loadDatabases = useSchemaStore((s) => s.loadDatabases);
  const loadSchemas = useSchemaStore((s) => s.loadSchemas);
  const loadTables = useSchemaStore((s) => s.loadTables);
  const loadViews = useSchemaStore((s) => s.loadViews);
  const loadFunctions = useSchemaStore((s) => s.loadFunctions);
  const loadFileAnalyticsSources = useSchemaStore(
    (s) => s.loadFileAnalyticsSources,
  );
  const clearFileAnalyticsSources = useSchemaStore(
    (s) => s.clearFileAnalyticsSources,
  );
  const prefetchSchemaColumns = useSchemaStore((s) => s.prefetchSchemaColumns);
  const evictSchemaForName = useSchemaStore((s) => s.evictSchemaForName);

  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());
  // Sprint 263 — autoLoaded set keyed by `connId|db|aux` so a re-render with
  // a different db triggers a fresh mount-time load. The aux bit lets a
  // no-schema DBMS rerun once when its dbType resolves and views/routines need
  // eager loading. Component-instance scoped (Set is recreated on remount) —
  // production DbSwitcher does not unmount the hook on toggle, so the set
  // survives toggles.
  const autoLoadedRef = useRef<Set<string>>(new Set());

  // Sprint 360 Phase 2 (Q23) — also re-run the auto-load when the
  // `schemas[connId]?.[db]` slot transitions from populated to undefined.
  // That transition is the signature of a post-DDL `clearForConnection`
  // wipe; without this signal the autoLoadedRef short-circuit would
  // permanently skip refetch even though the cache is empty and the
  // sidebar is mounted.
  const schemasSlot = useSchemaStore((s) => s.schemas[connectionId]?.[db]);
  useEffect(() => {
    // Sprint 263 — db === "" 는 transient (focused connection 의 activeDb 가
    // 아직 미해석된 mount 직후) sentinel. fetch 를 건너뛰고, activeDb 가
    // 잡히면 effect 가 재실행되며 정상 load 가 트리거된다.
    if (!db) return;
    const key = `${connectionId}|${db}|aux:${autoLoadAuxiliaryCatalog ? "1" : "0"}`;
    // Sprint 360 Phase 2 — when the slot is undefined (cleared) drop the
    // marker so the auto-load below fires again. This converts a
    // clearForConnection wipe into an eager refetch within the same hook
    // instance (no remount required).
    if (schemasSlot === undefined && autoLoadedRef.current.has(key)) {
      autoLoadedRef.current.delete(key);
    }
    if (autoLoadedRef.current.has(key)) return;
    autoLoadedRef.current.add(key);
    setLoadingSchemas(true);
    void loadDatabases(connectionId);
    loadSchemas(connectionId, db)
      .then(() => {
        const state = useSchemaStore.getState();
        const schemaList = state.schemas[connectionId]?.[db] ?? [];
        // #1219 — wide catalogs skip the eager per-schema fan-out; their
        // expanded schemas (seed + persisted set) are loaded lazily via
        // `expandSchema`, driven by the tree's reconciliation effect.
        if (
          !shouldEagerLoadSchemas(schemaList.length, autoLoadAuxiliaryCatalog)
        )
          return;
        for (const s of schemaList) {
          if (!state.tables[connectionId]?.[db]?.[s.name]) {
            loadTables(connectionId, db, s.name).catch((err) => {
              toast.error(
                i18n.t("schema:cache.loadTablesFailed", { name: s.name }),
              );
              logSchemaError(`loadTables(${s.name})`, err);
            });
          }
          if (
            autoLoadAuxiliaryCatalog &&
            !state.views[connectionId]?.[db]?.[s.name]
          ) {
            loadViews(connectionId, db, s.name).catch((err) => {
              toast.error(
                i18n.t("schema:cache.loadViewsFailed", { name: s.name }),
              );
              logSchemaError(`loadViews(${s.name})`, err);
            });
          }
          if (
            autoLoadAuxiliaryCatalog &&
            !state.functions[connectionId]?.[db]?.[s.name]
          ) {
            loadFunctions(connectionId, db, s.name).catch((err) => {
              toast.error(
                i18n.t("schema:cache.loadFunctionsFailed", { name: s.name }),
              );
              logSchemaError(`loadFunctions(${s.name})`, err);
            });
          }
          prefetchSchemaColumns(connectionId, db, s.name);
        }
      })
      .catch((err) => {
        toast.error(i18n.t("schema:cache.loadSchemasFailed"));
        logSchemaError("loadSchemas (mount)", err);
      })
      .finally(() => setLoadingSchemas(false));
  }, [
    connectionId,
    db,
    autoLoadAuxiliaryCatalog,
    schemasSlot,
    loadDatabases,
    loadSchemas,
    loadTables,
    loadViews,
    loadFunctions,
    prefetchSchemaColumns,
  ]);

  useEffect(() => {
    if (!db || !autoLoadFileAnalyticsSources) return;
    loadFileAnalyticsSources(connectionId).catch((err) => {
      toast.error(i18n.t("schema:cache.loadFileSourcesFailed"));
      logSchemaError("loadFileAnalyticsSources (mount)", err);
    });
  }, [
    connectionId,
    db,
    autoLoadFileAnalyticsSources,
    loadFileAnalyticsSources,
  ]);

  const refreshConnection = useCallback(() => {
    setLoadingSchemas(true);
    const clearSources = clearFileAnalyticsSourcesOnRefresh
      ? clearFileAnalyticsSources(connectionId)
      : Promise.resolve();
    clearSources
      .catch((err) => {
        toast.error(i18n.t("schema:cache.clearFileSourcesFailed"));
        logSchemaError("clearFileAnalyticsSources (refresh)", err);
      })
      .then(() => loadSchemas(connectionId, db))
      .catch((err) => {
        toast.error(i18n.t("schema:cache.refreshSchemasFailed"));
        logSchemaError("loadSchemas (refresh)", err);
      })
      .finally(() => setLoadingSchemas(false));
  }, [
    clearFileAnalyticsSources,
    clearFileAnalyticsSourcesOnRefresh,
    connectionId,
    db,
    loadSchemas,
  ]);

  const refreshSchema = useCallback(
    (schemaName: string) => {
      setLoadingTables((prev) => new Set(prev).add(schemaName));
      evictSchemaForName(connectionId, db, schemaName);
      loadTables(connectionId, db, schemaName)
        .catch((err) => {
          toast.error(
            i18n.t("schema:cache.reloadTablesFailed", { name: schemaName }),
          );
          logSchemaError(`loadTables (refresh ${schemaName})`, err);
        })
        .finally(() =>
          setLoadingTables((prev) => {
            const next = new Set(prev);
            next.delete(schemaName);
            return next;
          }),
        );
      loadViews(connectionId, db, schemaName).catch((err) => {
        toast.error(
          i18n.t("schema:cache.reloadViewsFailed", { name: schemaName }),
        );
        logSchemaError(`loadViews (refresh ${schemaName})`, err);
      });
      loadFunctions(connectionId, db, schemaName).catch((err) => {
        toast.error(
          i18n.t("schema:cache.reloadFunctionsFailed", { name: schemaName }),
        );
        logSchemaError(`loadFunctions (refresh ${schemaName})`, err);
      });
    },
    [
      connectionId,
      db,
      evictSchemaForName,
      loadTables,
      loadViews,
      loadFunctions,
    ],
  );

  const expandSchema = useCallback(
    async (schemaName: string) => {
      const state = useSchemaStore.getState();
      const dbSlot = state.tables[connectionId]?.[db];
      if (!dbSlot?.[schemaName]) {
        setLoadingTables((prev) => new Set(prev).add(schemaName));
        loadTables(connectionId, db, schemaName)
          .catch((err) => {
            toast.error(
              i18n.t("schema:cache.loadTablesFailed", { name: schemaName }),
            );
            logSchemaError(`loadTables (expand ${schemaName})`, err);
          })
          .finally(() =>
            setLoadingTables((prev) => {
              const next = new Set(prev);
              next.delete(schemaName);
              return next;
            }),
          );
      }
      const viewsDbSlot = state.views[connectionId]?.[db];
      if (!viewsDbSlot?.[schemaName]) {
        loadViews(connectionId, db, schemaName).catch((err) => {
          toast.error(
            i18n.t("schema:cache.loadViewsFailed", { name: schemaName }),
          );
          logSchemaError(`loadViews (expand ${schemaName})`, err);
        });
      }
      const functionsDbSlot = state.functions[connectionId]?.[db];
      if (!functionsDbSlot?.[schemaName]) {
        loadFunctions(connectionId, db, schemaName).catch((err) => {
          toast.error(
            i18n.t("schema:cache.loadFunctionsFailed", { name: schemaName }),
          );
          logSchemaError(`loadFunctions (expand ${schemaName})`, err);
        });
      }
      // #1219 — in the lazy path columns are not prefetched at mount, so an
      // expanded schema must pull its columns here to keep the SQL
      // autocomplete catalog populated (AC-2 no-regression). Best-effort,
      // guarded by cache presence so a toggle doesn't re-fetch. The eager
      // path already filled this slot at mount, so it's a no-op there.
      const columnsDbSlot = state.tableColumnsCache[connectionId]?.[db];
      if (!columnsDbSlot?.[schemaName]) {
        void prefetchSchemaColumns(connectionId, db, schemaName);
      }
    },
    [
      connectionId,
      db,
      loadTables,
      loadViews,
      loadFunctions,
      prefetchSchemaColumns,
    ],
  );

  return {
    schemas,
    loadingSchemas,
    loadingTables,
    refreshConnection,
    refreshSchema,
    expandSchema,
  };
}
