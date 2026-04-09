import { useState } from "react";
import { Plus, Database, Sun, Moon, Monitor } from "lucide-react";
import { useConnectionStore } from "../stores/connectionStore";
import { useTheme } from "../hooks/useTheme";
import ConnectionList from "./ConnectionList";
import ConnectionDialog from "./ConnectionDialog";
import SchemaTree from "./SchemaTree";

export default function Sidebar() {
  const [showNewDialog, setShowNewDialog] = useState(false);
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const { theme, setTheme } = useTheme();

  const connectedIds = connections
    .filter((c) => activeStatuses[c.id]?.type === "connected")
    .map((c) => c.id);

  const cycleTheme = () => {
    const next =
      theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
  };

  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <>
      <div className="flex h-full w-62.5 shrink-0 flex-col border-r border-(--color-border) bg-(--color-bg-sidebar)">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--color-border) px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">
            Connections
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setShowNewDialog(true)}
              className="rounded p-1 hover:bg-(--color-bg-tertiary) text-(--color-text-secondary)"
              aria-label="New Connection"
              title="New Connection"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Connection List */}
        <div className="flex-1 overflow-y-auto">
          {connections.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
              <Database size={32} className="mb-2 text-(--color-text-muted)" />
              <p className="text-sm text-(--color-text-muted)">
                No connections yet
              </p>
              <p className="mt-1 text-xs text-(--color-text-muted)">
                Click + to add a new connection
              </p>
            </div>
          ) : (
            <>
              <ConnectionList />
              {connectedIds.map((id) => (
                <SchemaTree key={id} connectionId={id} />
              ))}
            </>
          )}
        </div>

        {/* Footer — Theme Toggle */}
        <div className="border-t border-(--color-border) px-3 py-2">
          <button
            className="flex items-center gap-2 rounded p-1 text-xs text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-secondary) w-full"
            onClick={cycleTheme}
            aria-label={`Theme: ${theme}. Click to change.`}
          >
            <ThemeIcon size={14} />
            <span className="capitalize">{theme}</span>
          </button>
        </div>
      </div>

      {showNewDialog && (
        <ConnectionDialog onClose={() => setShowNewDialog(false)} />
      )}
    </>
  );
}
