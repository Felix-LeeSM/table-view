import { useCallback, useEffect, useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useConnectionStore } from "@stores/connectionStore";
import {
  currentKvDatabase,
  listKvDatabases,
  scanKvKeys,
  switchKvDatabase,
} from "@lib/tauri/kv";
import type { KvDatabaseInfo, KvKeyMetadata } from "@/types/kv";
import { formatKvTtl } from "@/types/kv";

const KEY_SCAN_LIMIT = 100;

export interface KvSidebarProps {
  connectionId: string;
}

export default function KvSidebar({ connectionId }: KvSidebarProps) {
  const connection = useConnectionStore((s) =>
    s.connections.find((c) => c.id === connectionId),
  );
  const status = useConnectionStore((s) => s.activeStatuses[connectionId]);
  const initialDatabase = useMemo(() => {
    const activeDb = status?.type === "connected" ? status.activeDb : undefined;
    const raw = activeDb ?? connection?.database ?? "0";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [connection?.database, status]);

  const [database, setDatabase] = useState(initialDatabase);
  const [databases, setDatabases] = useState<KvDatabaseInfo[]>([]);
  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<KvKeyMetadata[]>([]);
  const [nextCursor, setNextCursor] = useState("0");
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setError(null);
    try {
      const [databaseList, currentDatabase] = await Promise.all([
        listKvDatabases(connectionId),
        currentKvDatabase(connectionId),
      ]);
      setDatabases(databaseList);
      setDatabase(currentDatabase);
    } catch (err) {
      setDatabases([]);
      setDatabase(initialDatabase);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingCatalog(false);
    }
  }, [connectionId, initialDatabase]);

  const loadKeys = useCallback(
    async (cursor: string) => {
      setLoadingKeys(true);
      setError(null);
      try {
        const page = await scanKvKeys(connectionId, {
          database,
          cursor,
          pattern: pattern.trim() || "*",
          limit: KEY_SCAN_LIMIT,
        });
        setKeys((prev) =>
          cursor === "0" ? page.keys : [...prev, ...page.keys],
        );
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingKeys(false);
      }
    },
    [connectionId, database, pattern],
  );

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    setKeys([]);
    setNextCursor("0");
    void loadKeys("0");
  }, [database, loadKeys]);

  const handleDatabaseChange = async (value: string) => {
    const nextDatabase = Number.parseInt(value, 10);
    if (!Number.isFinite(nextDatabase) || nextDatabase < 0) return;
    setLoadingCatalog(true);
    setError(null);
    try {
      const switched = await switchKvDatabase(connectionId, nextDatabase);
      setDatabase(switched);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingCatalog(false);
    }
  };

  const databaseOptions =
    databases.length > 0
      ? databases
      : [{ name: String(database), index: database } satisfies KvDatabaseInfo];

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-secondary-foreground">
            <KeyRound size={13} aria-hidden />
            <span className="truncate">Keys</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <Select
              value={String(database)}
              disabled={loadingCatalog}
              onValueChange={(value) => void handleDatabaseChange(value)}
            >
              <SelectTrigger
                size="xs"
                className="h-6 max-w-28 rounded border-border bg-background px-1.5 text-3xs text-secondary-foreground"
                aria-label="Redis database"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {databaseOptions.map((item) => (
                  <SelectItem key={item.index} value={String(item.index)}>
                    DB {item.index}
                    {typeof item.keyCount === "number"
                      ? ` (${item.keyCount})`
                      : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh Redis keys"
          title="Refresh Redis keys"
          disabled={loadingCatalog || loadingKeys}
          onClick={() => {
            void loadCatalog();
            void loadKeys("0");
          }}
        >
          {loadingCatalog || loadingKeys ? (
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
          aria-label="Redis key pattern"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void loadKeys("0");
          }}
          placeholder="*"
        />
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
        <div role="tree" aria-label="Redis keys" className="py-1">
          {keys.map((item) => (
            <div
              key={item.key}
              role="treeitem"
              className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground"
            >
              <div className="flex min-w-0 items-center gap-2">
                {iconForKeyType(item.keyType)}
                <span className="min-w-0 flex-1 truncate">{item.key}</span>
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
            </div>
          ))}
        </div>

        {loadingKeys && keys.length === 0 && (
          <div
            role="status"
            className="flex items-center gap-2 px-3 py-3 text-muted-foreground"
          >
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Loading keys
          </div>
        )}

        {keys.length === 0 && !loadingKeys && !error && (
          <div role="status" className="px-3 py-3 text-muted-foreground">
            {emptyKeysMessage(pattern)}
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
              More
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function emptyKeysMessage(pattern: string) {
  const normalized = pattern.trim();
  if (!normalized || normalized === "*") return "No keys found.";
  return `No keys match pattern ${normalized}.`;
}

function iconForKeyType(type: KvKeyMetadata["keyType"]) {
  switch (type) {
    case "hash":
      return (
        <Hash
          size={12}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
    case "list":
    case "set":
    case "zSet":
      return (
        <List
          size={12}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
    case "stream":
      return (
        <Layers3
          size={12}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
    default:
      return (
        <KeyRound
          size={12}
          className="shrink-0 text-muted-foreground"
          aria-hidden
        />
      );
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact" }).format(value);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}
