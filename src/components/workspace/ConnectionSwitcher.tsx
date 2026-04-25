import { FileText, KeyRound, Search, Table2 } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import {
  useTabStore,
  useActiveTab,
  getLastActiveTabIdForConnection,
} from "@stores/tabStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { getConnectionColor } from "@lib/connectionColor";
import type { ConnectionConfig, Paradigm } from "@/types/connection";
import { assertNever } from "@lib/paradigm";

/**
 * Sprint 127 — return the lucide icon for a paradigm so the dropdown
 * options render `[paradigm icon] [color dot] [name]`.
 *
 * Centralised here rather than imported from a paradigm-icon util because
 * the existing TabBar inlines the same mapping (rdb → Table2,
 * document → leaf-style icon) and the toolbar's icon vocabulary should
 * track the tab bar's. The exhaustive switch + `assertNever` ensures any
 * future paradigm addition surfaces here as a TS compile error.
 */
function paradigmIcon(paradigm: Paradigm) {
  switch (paradigm) {
    case "rdb":
      return Table2;
    case "document":
      return FileText;
    case "search":
      return Search;
    case "kv":
      return KeyRound;
    default:
      return assertNever(paradigm);
  }
}

/**
 * Sprint 127 — `<ConnectionSwitcher>` for the workspace toolbar. The only
 * **active** of the three toolbar dropdowns; DB and Schema follow in
 * sprint 128/130/131.
 *
 * - Trigger label = active tab's connection name. When no tab is open or
 *   the active tab references a vanished connection, falls back to a
 *   placeholder ("No connection") and the trigger is disabled when there
 *   are no connected sessions.
 * - Options = `connections.filter(c => activeStatuses[c.id]?.type === "connected")`.
 *   Disconnected / connecting / errored connections are excluded — see
 *   the contract's S125 "Open한 연결만" decision.
 * - Selecting a connection routes through the graceful fallback chain:
 *     1. Last active tab id for the connection (in-memory tracker).
 *     2. First existing tab for the connection.
 *     3. Spawn a new query tab against that connection.
 */
export default function ConnectionSwitcher() {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const activeTab = useActiveTab();
  const setActiveTab = useTabStore((s) => s.setActiveTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);

  const activeConn: ConnectionConfig | null =
    activeTab !== null
      ? (connections.find((c) => c.id === activeTab.connectionId) ?? null)
      : null;

  const connectedConnections = connections.filter(
    (c) => activeStatuses[c.id]?.type === "connected",
  );

  const noConnected = connectedConnections.length === 0;
  const triggerLabel = activeConn?.name ?? "No connection";

  function handleChange(nextId: string) {
    if (nextId === activeConn?.id) return;
    // Step 1 — try the last active tab id for the chosen connection.
    const lastActive = getLastActiveTabIdForConnection(nextId);
    if (lastActive) {
      setActiveTab(lastActive);
      return;
    }
    // Step 2 — fall back to the first existing tab for the connection.
    const firstTab = useTabStore
      .getState()
      .tabs.find((t) => t.connectionId === nextId);
    if (firstTab) {
      setActiveTab(firstTab.id);
      return;
    }
    // Step 3 — spawn a new query tab so the user lands somewhere valid
    // even if no tab was ever opened against this connection. Paradigm is
    // taken from the connection so document-paradigm Mongo connections
    // open as `find` / `aggregate` query tabs (defaulting to "find" inside
    // `addQueryTab`).
    const conn = connections.find((c) => c.id === nextId);
    addQueryTab(nextId, { paradigm: conn?.paradigm ?? "rdb" });
  }

  return (
    <Select
      value={activeConn?.id ?? ""}
      onValueChange={handleChange}
      disabled={noConnected}
    >
      <SelectTrigger
        size="sm"
        aria-label="Active connection switcher"
        className="h-7 min-w-[10rem] gap-2 border-border bg-background px-2 text-xs"
      >
        <SelectValue placeholder={triggerLabel}>
          {activeConn ? (
            <span className="flex items-center gap-2">
              <ConnectionDot color={getConnectionColor(activeConn)} />
              <ParadigmIcon paradigm={activeConn.paradigm} />
              <span className="truncate">{activeConn.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{triggerLabel}</span>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {connectedConnections.map((c) => (
          <SelectItem
            key={c.id}
            value={c.id}
            // The Radix `Select.Item` always sets `aria-labelledby` to its
            // ItemText id, so the accessible name is computed from the
            // visible label. We additionally surface the contract-required
            // `aria-label="Connection: <name>"` attribute directly on the
            // option element (S125 AC-05) — this is what e2e selectors
            // and unit tests target via `[aria-label]` queries.
            aria-label={`Connection: ${c.name}`}
            textValue={c.name}
          >
            <span className="flex items-center gap-2">
              <ConnectionDot color={getConnectionColor(c)} />
              <ParadigmIcon paradigm={c.paradigm} />
              <span className="truncate">{c.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ConnectionDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function ParadigmIcon({ paradigm }: { paradigm: Paradigm }) {
  const Icon = paradigmIcon(paradigm);
  return (
    <Icon
      size={12}
      className="shrink-0 text-muted-foreground"
      aria-label={`${paradigm} paradigm`}
    />
  );
}
