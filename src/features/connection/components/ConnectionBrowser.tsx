import { toast } from "@lib/runtime/toast";
import { Clock, Layers } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnectionStore } from "../store";
import { draggedConnectionId } from "./ConnectionItem";
import ConnectionList from "./ConnectionList";
import RecentConnections from "./RecentConnections";

/**
 * #2440 — the launcher body: a group rail on the left, the matching
 * connections on the right. `All` and `Recent` are rail entries alongside the
 * groups, so adding groups widens the rail instead of lengthening the list.
 *
 * `Recent` used to be a collapsible footer strip under the list (sprint 296);
 * it is a rail view now, which is why HomePage no longer owns a collapse flag.
 */
type RailView =
  | { kind: "all" }
  | { kind: "recent" }
  | { kind: "group"; id: string };

const ALL_VIEW: RailView = { kind: "all" };

const ROW_CLASS =
  "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const ROW_ACTIVE_CLASS = "bg-primary/10 text-foreground";

interface ConnectionBrowserProps {
  /** Currently focused connection. Drives the selected ring on items. */
  selectedId?: string | null;
  /** Single-click selects a connection without connecting. */
  onSelect?: (id: string) => void;
  /** Fired after a successful double-click connect, so the parent can react. */
  onActivate?: (id: string) => void;
}

export default function ConnectionBrowser({
  selectedId = null,
  onSelect,
  onActivate,
}: ConnectionBrowserProps) {
  const { t } = useTranslation("featuresConnection");
  const groups = useConnectionStore((s) => s.groups);
  const moveConnectionToGroup = useConnectionStore(
    (s) => s.moveConnectionToGroup,
  );
  const [view, setView] = useState<RailView>(ALL_VIEW);
  const [dropGroupId, setDropGroupId] = useState<string | null>(null);

  // The selected group can vanish underneath the rail — deleted from the group
  // header in the `All` view, or removed by another window's broadcast. Derive
  // the live view rather than holding the dangling id, so a deleted group falls
  // back to `All` instead of leaving a pane that can never fill.
  const activeView =
    view.kind === "group" && !groups.some((g) => g.id === view.id)
      ? ALL_VIEW
      : view;

  return (
    <div className="flex flex-1 overflow-hidden">
      <nav
        data-testid="connection-rail"
        aria-label={t("rail.ariaLabel")}
        className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-1.5 select-none"
      >
        <button
          type="button"
          data-testid="rail-all"
          aria-pressed={activeView.kind === "all"}
          onClick={() => setView(ALL_VIEW)}
          className={`${ROW_CLASS}${activeView.kind === "all" ? ` ${ROW_ACTIVE_CLASS}` : ""}`}
        >
          <Layers size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{t("rail.all")}</span>
        </button>

        <button
          type="button"
          data-testid="rail-recent"
          aria-pressed={activeView.kind === "recent"}
          onClick={() => setView({ kind: "recent" })}
          className={`${ROW_CLASS}${activeView.kind === "recent" ? ` ${ROW_ACTIVE_CLASS}` : ""}`}
        >
          <Clock size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{t("rail.recent")}</span>
        </button>

        {groups.map((group) => {
          const active =
            activeView.kind === "group" && activeView.id === group.id;
          return (
            <button
              key={group.id}
              type="button"
              data-testid="rail-group"
              data-group-id={group.id}
              data-drop-target={dropGroupId === group.id ? "true" : undefined}
              aria-pressed={active}
              onClick={() => setView({ kind: "group", id: group.id })}
              // Dropping onto a rail group moves the connection into it. This is
              // the only cross-group drag route once a single group fills the
              // right pane — the other groups are not on screen to aim at.
              onDragOver={(e) => {
                if (!draggedConnectionId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDropGroupId(group.id);
              }}
              onDragLeave={() =>
                setDropGroupId((cur) => (cur === group.id ? null : cur))
              }
              onDragEnd={() => setDropGroupId(null)}
              onDrop={async (e) => {
                e.preventDefault();
                setDropGroupId(null);
                const connId =
                  draggedConnectionId ?? e.dataTransfer.getData("text/plain");
                if (!connId) return;
                try {
                  await moveConnectionToGroup(connId, group.id);
                } catch {
                  toast.error(t("errors.groupMoveFailed"));
                }
              }}
              className={`${ROW_CLASS}${active ? ` ${ROW_ACTIVE_CLASS}` : ""}${
                dropGroupId === group.id
                  ? " ring-1 ring-inset ring-primary/40"
                  : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-2 w-2 shrink-0 rounded-full border ${
                  group.color
                    ? "border-transparent"
                    : "border-border bg-transparent"
                }`}
                style={
                  group.color ? { backgroundColor: group.color } : undefined
                }
              />
              <span className="truncate">{group.name}</span>
            </button>
          );
        })}
      </nav>

      <div
        data-testid="connection-pane"
        className="flex flex-1 flex-col overflow-auto"
      >
        {activeView.kind === "recent" ? (
          <RecentConnections onActivate={onActivate} />
        ) : (
          <ConnectionList
            groupFilter={activeView.kind === "group" ? activeView.id : null}
            selectedId={selectedId}
            onSelect={onSelect}
            onActivate={onActivate}
          />
        )}
      </div>
    </div>
  );
}
