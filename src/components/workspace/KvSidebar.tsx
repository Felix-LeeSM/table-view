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
import { useConnectionStore } from "@stores/connectionStore";
import { getKvValue, scanKvKeys } from "@lib/tauri/kv";
import type { KvKeyMetadata, KvValueEnvelope } from "@/types/kv";
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
  const database = useMemo(() => {
    const activeDb = status?.type === "connected" ? status.activeDb : undefined;
    const raw = activeDb ?? connection?.database ?? "0";
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }, [connection?.database, status]);

  const [pattern, setPattern] = useState("*");
  const [keys, setKeys] = useState<KvKeyMetadata[]>([]);
  const [nextCursor, setNextCursor] = useState("0");
  const [loading, setLoading] = useState(false);
  const [loadingValue, setLoadingValue] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [value, setValue] = useState<KvValueEnvelope | null>(null);

  const loadKeys = useCallback(
    async (cursor: string) => {
      setLoading(true);
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
        setLoading(false);
      }
    },
    [connectionId, database, pattern],
  );

  const loadValue = useCallback(
    async (key: string) => {
      setSelectedKey(key);
      setLoadingValue(true);
      setError(null);
      try {
        const envelope = await getKvValue(connectionId, {
          database,
          key,
          limit: KEY_SCAN_LIMIT,
        });
        setValue(envelope);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingValue(false);
      }
    },
    [connectionId, database],
  );

  useEffect(() => {
    setKeys([]);
    setNextCursor("0");
    setSelectedKey(null);
    setValue(null);
    void loadKeys("0");
  }, [database, loadKeys]);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-medium text-secondary-foreground">
            <KeyRound size={13} aria-hidden />
            <span className="truncate">Keys</span>
          </div>
          <div className="mt-0.5 text-3xs text-muted-foreground">
            DB {database}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh Redis keys"
          title="Refresh Redis keys"
          disabled={loading}
          onClick={() => void loadKeys("0")}
        >
          {loading ? (
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
            <button
              key={item.key}
              type="button"
              role="treeitem"
              aria-selected={selectedKey === item.key}
              data-selected={selectedKey === item.key || undefined}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground data-[selected]:bg-accent data-[selected]:text-accent-foreground"
              onClick={() => void loadValue(item.key)}
            >
              {iconForKeyType(item.keyType)}
              <span className="min-w-0 flex-1 truncate">{item.key}</span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-3xs text-muted-foreground">
                {item.keyType}
              </span>
            </button>
          ))}
        </div>

        {loading && keys.length === 0 && (
          <div
            role="status"
            className="flex items-center gap-2 px-3 py-3 text-muted-foreground"
          >
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Loading keys
          </div>
        )}

        {keys.length === 0 && !loading && !error && (
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
              disabled={loading}
              onClick={() => void loadKeys(nextCursor)}
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : null}
              More
            </Button>
          </div>
        )}

        <KvValuePreview value={value} loading={loadingValue} />
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

function KvValuePreview({
  value,
  loading,
}: {
  value: KvValueEnvelope | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div
        role="status"
        className="border-t border-border px-3 py-3 text-muted-foreground"
      >
        Loading value
      </div>
    );
  }
  if (!value) return null;
  return (
    <div className="border-t border-border px-3 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-medium text-secondary-foreground">
          {value.key}
        </span>
        <span className="inline-flex items-center gap-1 text-3xs text-muted-foreground">
          <Timer size={11} aria-hidden />
          {formatKvTtl(value.metadata.ttl)}
        </span>
      </div>
      <pre className="max-h-48 overflow-auto rounded border border-border bg-muted/40 p-2 text-3xs text-foreground">
        {renderValueText(value)}
      </pre>
    </div>
  );
}

function renderValueText(envelope: KvValueEnvelope): string {
  const { value } = envelope;
  switch (value.type) {
    case "string":
      return value.text ?? value.hex ?? "";
    case "hash":
      return value.fields
        .map((field) => `${field.field}: ${field.value}`)
        .join("\n");
    case "list":
      return value.entries
        .map((entry) => `${entry.index}: ${entry.value}`)
        .join("\n");
    case "set":
      return value.members.join("\n");
    case "zSet":
      return value.entries
        .map((entry) => `${entry.member}: ${entry.score}`)
        .join("\n");
    case "stream":
      return value.entries
        .map(
          (entry) =>
            `${entry.id} ${entry.fields.map((f) => `${f.field}=${f.value}`).join(" ")}`,
        )
        .join("\n");
    case "json":
      return JSON.stringify(value.value, null, 2);
    case "missing":
      return "(missing)";
    case "unsupported":
      return value.message;
  }
}
