import { useState } from "react";
import {
  Plus,
  Database,
  Sun,
  Moon,
  Monitor,
  MousePointerClick,
} from "lucide-react";
import { useConnectionStore } from "../stores/connectionStore";
import { useTheme } from "../hooks/useTheme";
import ConnectionList from "./ConnectionList";
import ConnectionDialog from "./ConnectionDialog";
import SchemaTree from "./SchemaTree";
import type { DatabaseType } from "../types/connection";

/** Mapping of DB type to display label and color */
const DB_TYPE_META: Record<DatabaseType, { label: string; color: string }> = {
  postgresql: { label: "PostgreSQL", color: "#336791" },
  mysql: { label: "MySQL", color: "#4479A1" },
  sqlite: { label: "SQLite", color: "#003B57" },
  mongodb: { label: "MongoDB", color: "#47A248" },
  redis: { label: "Redis", color: "#DC382D" },
};

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
              <Database size={36} className="mb-3 text-(--color-text-muted)" />
              <p className="text-sm font-medium text-(--color-text-secondary)">
                No connections yet
              </p>
              <p className="mt-1 text-xs text-(--color-text-muted)">
                Click the + button above to add your first database connection
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                {(Object.keys(DB_TYPE_META) as DatabaseType[]).map((dbType) => (
                  <span
                    key={dbType}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{
                      backgroundColor: `${DB_TYPE_META[dbType].color}18`,
                      color: DB_TYPE_META[dbType].color,
                      border: `1px solid ${DB_TYPE_META[dbType].color}30`,
                    }}
                  >
                    {DB_TYPE_META[dbType].label}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-1.5 text-[10px] text-(--color-text-muted)">
                <MousePointerClick size={12} />
                <span>Double-click a connection to connect</span>
              </div>
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
