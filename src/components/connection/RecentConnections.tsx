import { useMruStore } from "@stores/mruStore";
import { useConnectionStore } from "@stores/connectionStore";
import { DB_TYPE_META } from "@lib/db-meta";
import { Database, Clock } from "lucide-react";

/**
 * Sprint 167 — format a `Date.now()` epoch ms timestamp as a short relative
 * time label (e.g. "just now", "5m ago", "3h ago", "2d ago").
 */
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface RecentConnectionsProps {
  onActivate?: (id: string) => void;
}

/**
 * Sprint 167 — Recent Connections UI for the launcher.
 *
 * Renders the user's most recently used connections (from `mruStore`) resolved
 * against the full connection list from `connectionStore`. Shows up to 5
 * entries with DB type badges and relative time labels.
 *
 * Activation: double-click or Enter triggers `onActivate`.
 */
export default function RecentConnections({
  onActivate,
}: RecentConnectionsProps) {
  const recentConnections = useMruStore((s) => s.recentConnections);
  const connections = useConnectionStore((s) => s.connections);

  // Resolve MRU entries to full connection details
  const resolved = recentConnections
    .map((entry) => ({
      ...entry,
      conn: connections.find((c) => c.id === entry.connectionId),
    }))
    .filter((item) => item.conn != null);

  if (resolved.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground italic">
        No recent connections
      </div>
    );
  }

  return (
    <div className="space-y-0.5" role="list" aria-label="Recent connections">
      {resolved.slice(0, 5).map(({ connectionId, lastUsed, conn }) => (
        <div
          key={connectionId}
          role="listitem"
          className="flex items-center gap-2 px-3 py-1 text-sm cursor-pointer hover:bg-muted rounded-sm"
          aria-label={`${conn!.name} — used ${relativeTime(lastUsed)}`}
          tabIndex={0}
          onClick={() => {}} // single click: nothing special
          onDoubleClick={() => onActivate?.(connectionId)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onActivate?.(connectionId);
          }}
        >
          <Database size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-foreground">{conn!.name}</span>
          <span
            className="ml-auto shrink-0 rounded px-1 py-0.5 text-4xs font-semibold leading-none"
            style={{
              backgroundColor: `${DB_TYPE_META[conn!.db_type].color}20`,
              color: DB_TYPE_META[conn!.db_type].color,
            }}
          >
            {DB_TYPE_META[conn!.db_type].short}
          </span>
          <Clock size={10} className="shrink-0 text-muted-foreground" />
          <span className="text-3xs text-muted-foreground whitespace-nowrap">
            {relativeTime(lastUsed)}
          </span>
        </div>
      ))}
    </div>
  );
}
