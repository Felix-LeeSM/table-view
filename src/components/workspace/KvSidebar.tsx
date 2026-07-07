import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Hash,
  KeyRound,
  Layers3,
  List,
  Loader2,
  RefreshCw,
  Search,
  Timer,
} from "lucide-react";
import { Button } from "@components/ui/button";
import {
  useTreeRoving,
  type TreeRovingRow,
} from "@components/shared/tree/useTreeRoving";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { currentKvDatabase, scanKvKeys } from "@lib/tauri/kv";
import type { KvKeyMetadata } from "@/types/kv";
import { formatKvTtl } from "@/types/kv";
import { DATABASE_TYPE_LABELS } from "@/types/connection";
import { formatBytes, formatCount } from "./kvValueFormat";

const KEY_SCAN_LIMIT = 100;

export interface KvSidebarProps {
  connectionId: string;
}

export default function KvSidebar({ connectionId }: KvSidebarProps) {
  const { t } = useTranslation("workspace");
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );
  const status = useConnectionStore((s) => s.activeStatuses[connectionId]);
  const setActiveDb = useConnectionStore((s) => s.setActiveDb);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const safeMode = useSafeModeStore((s) => s.mode);
  const autoScanAllowed = safeMode === "off";
  const productLabel = connection
    ? DATABASE_TYPE_LABELS[connection.dbType]
    : "Redis";
  const initialDatabase = useMemo(() => {
    const activeDb = status?.type === "connected" ? status.activeDb : undefined;
    const raw = activeDb ?? connection?.database ?? "0";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [connection?.database, status]);

  const [database, setDatabase] = useState(initialDatabase);
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<KvKeyMetadata[]>([]);
  const [nextCursor, setNextCursor] = useState("0");
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [hasScannedKeys, setHasScannedKeys] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const autoScanRef = useRef(false);
  const rootScanInFlightRef = useRef<string | null>(null);
  const latestKeyScanRef = useRef(0);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogLoaded(false);
    setError(null);
    try {
      const currentDatabase = await currentKvDatabase(connectionId);
      setDatabase(currentDatabase);
    } catch (err) {
      setDatabase(initialDatabase);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingCatalog(false);
      setCatalogLoaded(true);
    }
  }, [connectionId, initialDatabase]);

  const loadKeys = useCallback(
    async (cursor: string) => {
      const normalizedPattern = pattern.trim() || "*";
      const rootScanKey =
        cursor === "0"
          ? `${connectionId}:${database}:${normalizedPattern}`
          : null;
      if (rootScanKey && rootScanInFlightRef.current === rootScanKey) return;
      if (rootScanKey) rootScanInFlightRef.current = rootScanKey;
      const scanId = latestKeyScanRef.current + 1;
      latestKeyScanRef.current = scanId;
      if (cursor === "0") setHasScannedKeys(true);
      setLoadingKeys(true);
      setError(null);
      try {
        const page = await scanKvKeys(connectionId, {
          database,
          cursor,
          pattern: normalizedPattern,
          limit: KEY_SCAN_LIMIT,
        });
        if (latestKeyScanRef.current !== scanId) return;
        setKeys((prev) =>
          cursor === "0" ? page.keys : [...prev, ...page.keys],
        );
        setNextCursor(page.nextCursor);
      } catch (err) {
        if (latestKeyScanRef.current !== scanId) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (latestKeyScanRef.current === scanId) {
          setLoadingKeys(false);
        }
        if (rootScanKey && rootScanInFlightRef.current === rootScanKey) {
          rootScanInFlightRef.current = null;
        }
      }
    },
    [connectionId, database, pattern],
  );

  // Open the selected key in a right-hand detail tab (kv paradigm), mirroring
  // the search sidebar → SearchIndexDetailPanel navigation. The sidebar owns
  // scan + selection only; the tab hosts value inspection and mutation.
  const openKeyDetail = useCallback(
    (key: string) => {
      setSelectedKey(key);
      const db = String(database);
      // Align the connection's active DB with the tab's workspace bucket so
      // MainArea's (connId, activeDb) key resolves to where the tab lives
      // (same guarantee SearchSidebar makes with SEARCH_WORKSPACE_DB).
      setActiveDb(connectionId, db);
      addTab(connectionId, {
        title: key,
        connectionId,
        type: "table",
        closable: true,
        database: db,
        schema: db,
        table: key,
        subView: "structure",
        paradigm: "kv",
      });
    },
    [addTab, connectionId, database, setActiveDb],
  );

  useEffect(() => {
    latestKeyScanRef.current += 1;
    autoScanRef.current = false;
    rootScanInFlightRef.current = null;
    setCatalogLoaded(false);
    setKeys([]);
    setNextCursor("0");
    setSelectedKey(null);
    setHasScannedKeys(false);
  }, [connectionId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    setDatabase(initialDatabase);
  }, [initialDatabase]);

  useEffect(() => {
    latestKeyScanRef.current += 1;
    setKeys([]);
    setNextCursor("0");
    setSelectedKey(null);
    setHasScannedKeys(false);
  }, [connectionId, database]);

  useEffect(() => {
    if (!catalogLoaded || !autoScanAllowed || autoScanRef.current) return;
    autoScanRef.current = true;
    void loadKeys("0");
  }, [autoScanAllowed, catalogLoaded, loadKeys]);

  const canScanKeys = catalogLoaded && !loadingCatalog && !loadingKeys;
  const scanStatusText = hasScannedKeys
    ? `${keys.length} key${keys.length === 1 ? "" : "s"}${
        nextCursor !== "0" ? ` · cursor ${nextCursor}` : ""
      }`
    : safeMode === "off"
      ? t("kvSidebar.scanPending")
      : t("kvSidebar.scanPaused");

  // WAI-ARIA tree roving over the flat key list — one tab stop, arrow-key nav.
  // Single level, so every row is a leaf (no expand/collapse) and toggle is a
  // no-op. Not virtualized, so no scroll-into-view callback.
  const treeRef = useRef<HTMLDivElement>(null);
  const rovingRows: TreeRovingRow[] = keys.map((item) => ({
    key: item.key,
    depth: 0,
    expanded: null,
    focusable: true,
  }));
  const roving = useTreeRoving(rovingRows, () => {}, treeRef);
  const activeKey = roving.focusKey ?? keys[0]?.key ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-secondary-foreground">
            <KeyRound size={13} aria-hidden />
            <span className="truncate">{t("kvSidebar.keysHeader")}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("kvSidebar.refreshCatalogAria", { productLabel })}
          title={t("kvSidebar.refreshCatalogTitle", { productLabel })}
          disabled={loadingCatalog}
          onClick={() => {
            void loadCatalog();
          }}
        >
          {loadingCatalog ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <Search size={12} className="text-muted-foreground" aria-hidden />
        <input
          className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          aria-label={t("kvSidebar.keyPatternAria", { productLabel })}
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canScanKeys) void loadKeys("0");
          }}
          placeholder="*"
        />
        <Button
          variant="secondary"
          size="xs"
          className="shrink-0"
          disabled={!canScanKeys}
          onClick={() => void loadKeys("0")}
        >
          {loadingKeys ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Search size={12} />
          )}
          {t("kvSidebar.scanButton", { limit: KEY_SCAN_LIMIT })}
        </Button>
      </div>

      <div
        className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-3xs text-muted-foreground"
        data-testid="redis-scan-status"
        // #1137 — announce scanned-key count / cursor politely; busy while
        // scanning. Bare `aria-live` (no `role="status"`) keeps this a live
        // region without colliding with the sidebar's transient status
        // messages (safe-mode / loading), which own the single status role.
        aria-live="polite"
        aria-busy={loadingKeys || undefined}
      >
        <span>{t("kvSidebar.limitLabel", { limit: KEY_SCAN_LIMIT })}</span>
        <span>{scanStatusText}</span>
      </div>

      {error && (
        <div
          role="alert"
          className="border-b border-border px-3 py-2 text-destructive"
        >
          {error}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={treeRef}
          role="tree"
          aria-label={t("kvSidebar.keysAria", { productLabel })}
          className="py-1"
          onKeyDown={roving.onKeyDown}
        >
          {keys.map((item, index) => (
            <button
              key={item.key}
              type="button"
              role="treeitem"
              aria-level={1}
              aria-selected={selectedKey === item.key}
              aria-setsize={keys.length}
              aria-posinset={index + 1}
              data-selected={selectedKey === item.key || undefined}
              data-tree-key={item.key}
              tabIndex={activeKey === item.key ? 0 : -1}
              onFocus={() => roving.setFocusKey(item.key)}
              className="grid min-h-8 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground data-[selected]:bg-accent data-[selected]:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => openKeyDetail(item.key)}
            >
              <div className="flex min-w-0 items-center gap-2">
                {iconForKeyType(item.keyType)}
                <span className="min-w-0 flex-1 truncate text-sm">
                  {item.key}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-3xs text-muted-foreground">
                <span className="rounded bg-muted px-1.5 py-0.5">
                  {item.keyType}
                </span>
                {typeof item.length === "number" && (
                  <span>{formatCount(item.length)}</span>
                )}
                {typeof item.memoryBytes === "number" && (
                  <span>{formatBytes(item.memoryBytes)}</span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Timer size={11} aria-hidden />
                  {formatKvTtl(item.ttl)}
                </span>
              </div>
            </button>
          ))}
        </div>

        {loadingKeys && keys.length === 0 && (
          <div
            role="status"
            className="flex items-center gap-2 px-3 py-3 text-muted-foreground"
          >
            <Loader2 size={12} className="animate-spin" aria-hidden />
            {t("kvSidebar.loadingKeys")}
          </div>
        )}

        {keys.length === 0 && !loadingKeys && !error && (
          <div role="status" className="px-3 py-3 text-muted-foreground">
            {emptyKeysMessage(pattern, hasScannedKeys, safeMode, t)}
          </div>
        )}

        {nextCursor !== "0" && (
          <div className="px-3 py-2">
            <Button
              variant="secondary"
              size="xs"
              className="w-full"
              disabled={loadingKeys}
              onClick={() => void loadKeys(nextCursor)}
            >
              {loadingKeys ? (
                <Loader2 size={12} className="animate-spin" />
              ) : null}
              {t("kvSidebar.moreCursor", { cursor: nextCursor })}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function emptyKeysMessage(
  pattern: string,
  hasScannedKeys: boolean,
  safeMode: "strict" | "warn" | "off",
  t: (key: string, opts?: Record<string, unknown>) => string,
) {
  if (!hasScannedKeys) {
    if (safeMode === "off") return t("kvSidebar.emptyWaiting");
    return t("kvSidebar.emptySafeModeHalt", { limit: KEY_SCAN_LIMIT });
  }
  const normalized = pattern.trim();
  if (!normalized || normalized === "*") return t("kvSidebar.emptyNoKeys");
  return t("kvSidebar.emptyNoMatch", { pattern: normalized });
}

function iconForKeyType(type: KvKeyMetadata["keyType"]) {
  const Icon =
    type === "hash"
      ? Hash
      : type === "stream"
        ? Layers3
        : type === "list" || type === "set" || type === "zSet"
          ? List
          : KeyRound;
  return (
    <Icon size={12} className="shrink-0 text-muted-foreground" aria-hidden />
  );
}
