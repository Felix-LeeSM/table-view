import { useCallback, useEffect, useRef, useState } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import { toast } from "@/lib/toast";
import type { SchemaInfo } from "@/types/schema";

/**
 * Sprint 191 (AC-191-02) — SchemaTree 의 데이터 레이어 hook. 1963 줄 god
 * component 에서 schema/table/view/function 로딩과 캐시 무효화 책임을
 * 분리해 UI 가 순수 트리 렌더링에 집중할 수 있게 한다.
 *
 * 책임:
 * - mount 시 자동 `loadSchemas` + 모든 schema 의 `loadTables` /
 *   `prefetchSchemaColumns` (기존 SchemaTree:495-512 동작 그대로).
 * - schema 한 개 단위 lazy expand (`expandSchema`) — 캐시 미존재 시에만
 *   load.
 * - 전체 / 단일 schema refresh (`refreshConnection`, `refreshSchema`).
 * - silent failure 9건을 toast.error + dev console 로 일원화 (smell §5).
 *
 * 책임 외:
 * - 트리 UI state (expanded / selected / search) 는 컴포넌트가 보유.
 * - dropTable / renameTable 등 사용자 액션 catch 는 컴포넌트 layer 가
 *   처리 (UI dialog state 와 합쳐져 있어 hook 으로 옮기면 응집도 손해).
 */

const EMPTY_SCHEMAS: SchemaInfo[] = [];

/** Best-effort dev-mode console logging for failed schema fetches. */
function logSchemaError(label: string, err: unknown): void {
  if (import.meta.env.DEV) {
    console.error(`[useSchemaCache] ${label}:`, err);
  }
}

export interface UseSchemaCacheReturn {
  schemas: SchemaInfo[];
  loadingSchemas: boolean;
  loadingTables: ReadonlySet<string>;
  refreshConnection(): void;
  refreshSchema(schemaName: string): void;
  expandSchema(schemaName: string): Promise<void>;
}

export function useSchemaCache(connectionId: string): UseSchemaCacheReturn {
  const schemas =
    useSchemaStore((s) => s.schemas[connectionId]) ?? EMPTY_SCHEMAS;
  const loadSchemas = useSchemaStore((s) => s.loadSchemas);
  const loadTables = useSchemaStore((s) => s.loadTables);
  const loadViews = useSchemaStore((s) => s.loadViews);
  const loadFunctions = useSchemaStore((s) => s.loadFunctions);
  const prefetchSchemaColumns = useSchemaStore((s) => s.prefetchSchemaColumns);
  const evictSchemaForName = useSchemaStore((s) => s.evictSchemaForName);

  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());
  const autoLoadedRef = useRef<string | null>(null);

  // mount 시 자동 로드 + 모든 schema 의 tables / column prefetch.
  useEffect(() => {
    if (autoLoadedRef.current === connectionId) return;
    autoLoadedRef.current = connectionId;
    setLoadingSchemas(true);
    loadSchemas(connectionId)
      .then(() => {
        const state = useSchemaStore.getState();
        const schemaList = state.schemas[connectionId] ?? [];
        for (const s of schemaList) {
          if (!state.tables[`${connectionId}:${s.name}`]) {
            loadTables(connectionId, s.name).catch((err) => {
              toast.error(`Failed to load tables for ${s.name}`);
              logSchemaError(`loadTables(${s.name})`, err);
            });
          }
          prefetchSchemaColumns(connectionId, s.name);
        }
      })
      .catch((err) => {
        toast.error("Failed to load schemas");
        logSchemaError("loadSchemas (mount)", err);
      })
      .finally(() => setLoadingSchemas(false));
  }, [connectionId, loadSchemas, loadTables, prefetchSchemaColumns]);

  const refreshConnection = useCallback(() => {
    setLoadingSchemas(true);
    loadSchemas(connectionId)
      .catch((err) => {
        toast.error("Failed to refresh schemas");
        logSchemaError("loadSchemas (refresh)", err);
      })
      .finally(() => setLoadingSchemas(false));
  }, [connectionId, loadSchemas]);

  const refreshSchema = useCallback(
    (schemaName: string) => {
      setLoadingTables((prev) => new Set(prev).add(schemaName));
      evictSchemaForName(connectionId, schemaName);
      loadTables(connectionId, schemaName)
        .catch((err) => {
          toast.error(`Failed to reload tables for ${schemaName}`);
          logSchemaError(`loadTables (refresh ${schemaName})`, err);
        })
        .finally(() =>
          setLoadingTables((prev) => {
            const next = new Set(prev);
            next.delete(schemaName);
            return next;
          }),
        );
      loadViews(connectionId, schemaName).catch((err) => {
        toast.error(`Failed to reload views for ${schemaName}`);
        logSchemaError(`loadViews (refresh ${schemaName})`, err);
      });
      loadFunctions(connectionId, schemaName).catch((err) => {
        toast.error(`Failed to reload functions for ${schemaName}`);
        logSchemaError(`loadFunctions (refresh ${schemaName})`, err);
      });
    },
    [connectionId, evictSchemaForName, loadTables, loadViews, loadFunctions],
  );

  const expandSchema = useCallback(
    async (schemaName: string) => {
      const state = useSchemaStore.getState();
      const key = `${connectionId}:${schemaName}`;
      if (!state.tables[key]) {
        setLoadingTables((prev) => new Set(prev).add(schemaName));
        loadTables(connectionId, schemaName)
          .catch((err) => {
            toast.error(`Failed to load tables for ${schemaName}`);
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
      if (!state.views[key]) {
        loadViews(connectionId, schemaName).catch((err) => {
          toast.error(`Failed to load views for ${schemaName}`);
          logSchemaError(`loadViews (expand ${schemaName})`, err);
        });
      }
      if (!state.functions[key]) {
        loadFunctions(connectionId, schemaName).catch((err) => {
          toast.error(`Failed to load functions for ${schemaName}`);
          logSchemaError(`loadFunctions (expand ${schemaName})`, err);
        });
      }
    },
    [connectionId, loadTables, loadViews, loadFunctions],
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
