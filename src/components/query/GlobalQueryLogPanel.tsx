import { useState, useEffect } from "react";
import {
  Search,
  Trash2,
  X,
  Copy,
  CheckCircle2,
  XCircle,
  CircleSlash,
} from "lucide-react";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import ConfirmDialog from "@components/shared/ConfirmDialog";
import QuerySyntax from "@components/shared/QuerySyntax";
import QueryHistorySourceBadge from "@components/shared/QueryHistorySourceBadge";
import { cn } from "@lib/utils";

// Sprint-112: Radix `<SelectItem>` cannot have an empty value, so we use
// sentinel string `__all__` for the "All connections" option. The component
// state still keeps `null` (canonical "no filter").
const CONN_FILTER_ALL_SENTINEL = "__all__";

function truncateSql(sql: string, maxLen: number): string {
  if (sql.length <= maxLen) return sql;
  return sql.slice(0, maxLen) + "...";
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

interface GlobalQueryLogPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function GlobalQueryLogPanel({
  visible,
  onClose,
}: GlobalQueryLogPanelProps) {
  const [search, setSearch] = useState("");
  const [connectionFilter, setConnectionFilter] = useState<string | null>(null);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const globalLog = useQueryHistoryStore((s) => s.globalLog);
  const clearGlobalLog = useQueryHistoryStore((s) => s.clearGlobalLog);
  const copyEntry = useQueryHistoryStore((s) => s.copyEntry);
  const connections = useConnectionStore((s) => s.connections);

  // Reset local state when panel closes
  useEffect(() => {
    if (!visible) {
      setSearch("");
      setConnectionFilter(null);
      setExpandedEntry(null);
    }
  }, [visible]);

  if (!visible) return null;

  const filtered = globalLog.filter((entry) => {
    const matchesSearch =
      !search || entry.sql.toLowerCase().includes(search.toLowerCase());
    const matchesConnection =
      !connectionFilter || entry.connectionId === connectionFilter;
    return matchesSearch && matchesConnection;
  });

  // Derive unique connection IDs that appear in the log
  const connectionIds = [
    ...new Set(globalLog.map((e) => e.connectionId)),
  ].filter(Boolean);

  const getConnectionName = (id: string): string => {
    const conn = connections.find((c) => c.id === id);
    return conn?.name ?? id;
  };

  const handleCopy = async (entryId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await copyEntry(entryId);
  };

  const handleEntryClick = (entryId: string) => {
    setExpandedEntry((prev) => (prev === entryId ? null : entryId));
  };

  return (
    <div
      data-testid="global-query-log-panel"
      className="flex flex-col border-t border-border bg-secondary"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-foreground">Query Log</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-3xs font-medium text-muted-foreground">
          {globalLog.length}
        </span>
        <div className="flex flex-1 items-center gap-1.5">
          <Search size={12} className="shrink-0 text-muted-foreground" />
          <Input
            type="text"
            data-testid="global-log-search"
            className="h-5 flex-1 border-0 bg-transparent text-xs shadow-none text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
            placeholder="Search queries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Connection filter dropdown */}
        <div className="relative">
          <Select
            value={connectionFilter ?? CONN_FILTER_ALL_SENTINEL}
            onValueChange={(v) =>
              setConnectionFilter(v === CONN_FILTER_ALL_SENTINEL ? null : v)
            }
          >
            <SelectTrigger
              data-testid="global-log-connection-filter"
              className="h-5 rounded border border-border bg-transparent px-1 text-3xs text-foreground"
              aria-label="Connection filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={CONN_FILTER_ALL_SENTINEL}>
                All connections
              </SelectItem>
              {connectionIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {getConnectionName(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="ghost"
          size="xs"
          className="gap-1 bg-muted text-muted-foreground hover:text-foreground"
          onClick={() => setShowClearConfirm(true)}
          aria-label="Clear global log"
        >
          <Trash2 size={12} />
          Clear
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close query log"
        >
          <X size={14} />
        </Button>
      </div>

      {/* Entries */}
      <div className="max-h-scroll-lg overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {globalLog.length === 0
              ? "No queries executed yet"
              : "No matching queries"}
          </div>
        ) : (
          filtered.map((entry) => (
            <div
              key={entry.id}
              role="button"
              tabIndex={0}
              data-testid={`global-log-entry-${entry.id}`}
              className={cn(
                "flex flex-col px-3 py-1 text-xs hover:bg-muted cursor-pointer",
                // Sprint 180 (AC-180-03) — cancelled gets a muted bg
                // (calm secondary, not destructive) so the user can
                // still pick the entry out of the log without it
                // looking like a failure.
                entry.status === "error" && "bg-destructive/10",
                entry.status === "cancelled" && "bg-muted/40",
              )}
              onClick={() => handleEntryClick(entry.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleEntryClick(entry.id);
                }
              }}
            >
              <div className="flex items-center gap-2">
                {/* Status icon */}
                <span
                  className="shrink-0"
                  title={entry.status}
                  data-status={entry.status}
                >
                  {/* Sprint 180 (AC-180-03) — three-way status icon.
                      Cancelled entries get a calm CircleSlash in the
                      muted-foreground colour so the user reads them as
                      self-aborted rather than failed. */}
                  {entry.status === "success" ? (
                    <CheckCircle2 size={12} className="text-success" />
                  ) : entry.status === "cancelled" ? (
                    <CircleSlash size={12} className="text-muted-foreground" />
                  ) : (
                    <XCircle size={12} className="text-destructive" />
                  )}
                </span>
                {/* SQL text */}
                <QuerySyntax
                  className="flex-1 truncate text-foreground"
                  sql={
                    expandedEntry === entry.id
                      ? entry.sql
                      : truncateSql(entry.sql, 80)
                  }
                  paradigm={entry.paradigm}
                  queryMode={entry.queryMode}
                />
                {/* Copy button */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={(e) => handleCopy(entry.id, e)}
                  aria-label="Copy SQL"
                >
                  <Copy size={10} />
                </Button>
                {/* Timestamp */}
                <span className="shrink-0 text-muted-foreground">
                  {formatRelativeTime(entry.executedAt)}
                </span>
                {/* Duration badge */}
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  {entry.duration}ms
                </span>
                {/* Connection badge */}
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  {getConnectionName(entry.connectionId)}
                </span>
                {/* Paradigm badge — SQL for relational entries, MQL for
                    document entries. Sprint 123 introduces this so the
                    mixed log is scannable at a glance without inspecting
                    the truncated query text. */}
                <span
                  className="shrink-0 rounded bg-secondary px-2 py-0.5 font-mono text-secondary-foreground"
                  data-paradigm={entry.paradigm}
                >
                  {entry.paradigm === "document" ? "MQL" : "SQL"}
                </span>
                {/* Secondary queryMode tag — only meaningful for document
                    entries (find / aggregate). RDB entries are always
                    queryMode === "sql", which is redundant with the
                    paradigm badge, so suppress it there. */}
                {entry.paradigm === "document" && entry.queryMode && (
                  <span
                    className="shrink-0 rounded bg-secondary px-2 py-0.5 text-secondary-foreground"
                    data-query-mode={entry.queryMode}
                  >
                    {entry.queryMode}
                  </span>
                )}
                {/* Source badge — Sprint 196 (AC-196-06). raw entries
                    suppressed inside component. */}
                <QueryHistorySourceBadge source={entry.source} />
              </div>
              {/* Expanded SQL view */}
              {expandedEntry === entry.id && entry.sql.length > 80 && (
                <pre className="mt-1 whitespace-pre-wrap break-all border-t border-border pl-7 pt-1 font-mono text-2xs text-foreground">
                  <QuerySyntax
                    sql={entry.sql}
                    paradigm={entry.paradigm}
                    queryMode={entry.queryMode}
                  />
                </pre>
              )}
            </div>
          ))
        )}
      </div>

      {showClearConfirm && (
        <ConfirmDialog
          title="Clear Global Query Log"
          message="Are you sure you want to clear the global query log? This cannot be undone."
          confirmLabel="Clear All"
          danger
          onConfirm={() => {
            clearGlobalLog();
            setShowClearConfirm(false);
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}
