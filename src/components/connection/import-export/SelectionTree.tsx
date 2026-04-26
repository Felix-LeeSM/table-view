import { useEffect, useMemo, useRef } from "react";
import type { ConnectionConfig, ConnectionGroup } from "@/types/connection";
import { cn } from "@/lib/utils";

export interface SelectionTreeProps {
  connections: ConnectionConfig[];
  groups: ConnectionGroup[];
  /** Selected connection ids. */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

interface ResolvedGroup {
  /** Group id, or `null` for the synthetic "(No group)" pseudo-group. */
  id: string | null;
  name: string;
  connections: ConnectionConfig[];
}

/**
 * Sprint 140 — multi-select connection picker with indeterminate group
 * checkboxes. The header offers a master "Select all" toggle alongside a
 * "X connections, Y groups selected" counter. Each group renders its
 * children as nested checkboxes; the group header checkbox flips into
 * `indeterminate` when only some children are selected.
 *
 * Connections that do not belong to any group are rendered under a
 * synthetic `(No group)` pseudo-group so the user can still select-all
 * uncategorised connections in one click.
 */
export default function SelectionTree({
  connections,
  groups,
  selected,
  onChange,
}: SelectionTreeProps) {
  const allConnIds = useMemo(() => connections.map((c) => c.id), [connections]);

  const resolvedGroups = useMemo<ResolvedGroup[]>(() => {
    const grouped: ResolvedGroup[] = groups
      .map((g) => ({
        id: g.id,
        name: g.name,
        connections: connections.filter((c) => c.group_id === g.id),
      }))
      .filter((g) => g.connections.length > 0);

    const ungrouped = connections.filter((c) => !c.group_id);
    if (ungrouped.length > 0) {
      grouped.push({
        id: null,
        name: "(No group)",
        connections: ungrouped,
      });
    }
    return grouped;
  }, [connections, groups]);

  const selectedCount = useMemo(
    () => connections.filter((c) => selected.has(c.id)).length,
    [connections, selected],
  );

  const fullySelectedGroupCount = useMemo(
    () =>
      resolvedGroups.filter(
        (g) =>
          g.connections.length > 0 &&
          g.connections.every((c) => selected.has(c.id)),
      ).length,
    [resolvedGroups, selected],
  );

  const allChecked =
    connections.length > 0 && selectedCount === connections.length;
  const noneChecked = selectedCount === 0;
  const masterIndeterminate = !noneChecked && !allChecked;

  const masterRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (masterRef.current) {
      masterRef.current.indeterminate = masterIndeterminate;
    }
  }, [masterIndeterminate]);

  const toggleAll = (next: boolean) => {
    onChange(next ? new Set(allConnIds) : new Set());
  };

  const toggleGroup = (group: ResolvedGroup, next: boolean) => {
    const out = new Set(selected);
    for (const c of group.connections) {
      if (next) out.add(c.id);
      else out.delete(c.id);
    }
    onChange(out);
  };

  const toggleConnection = (id: string) => {
    const out = new Set(selected);
    if (out.has(id)) out.delete(id);
    else out.add(id);
    onChange(out);
  };

  if (connections.length === 0) {
    return (
      <div
        role="status"
        className="rounded border border-border bg-background px-3 py-4 text-center text-xs text-muted-foreground"
      >
        No connections to export.
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-background">
      {/* Header: master checkbox + counter */}
      <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 font-medium text-secondary-foreground">
          <input
            ref={masterRef}
            type="checkbox"
            aria-label={`Select all (${connections.length})`}
            aria-checked={
              masterIndeterminate ? "mixed" : allChecked ? "true" : "false"
            }
            checked={allChecked}
            onChange={(e) => toggleAll(e.target.checked)}
          />
          <span>Select all ({connections.length})</span>
        </label>
        <span className="ml-auto text-muted-foreground">
          {selectedCount} connection{selectedCount === 1 ? "" : "s"},{" "}
          {fullySelectedGroupCount} group
          {fullySelectedGroupCount === 1 ? "" : "s"} selected
        </span>
      </div>

      <div className="max-h-60 overflow-auto">
        {resolvedGroups.map((group) => (
          <GroupSection
            key={group.id ?? "__nogroup__"}
            group={group}
            selected={selected}
            onToggleGroup={(next) => toggleGroup(group, next)}
            onToggleConnection={toggleConnection}
          />
        ))}
      </div>
    </div>
  );
}

interface GroupSectionProps {
  group: ResolvedGroup;
  selected: Set<string>;
  onToggleGroup: (next: boolean) => void;
  onToggleConnection: (id: string) => void;
}

function GroupSection({
  group,
  selected,
  onToggleGroup,
  onToggleConnection,
}: GroupSectionProps) {
  const childSelectedCount = group.connections.filter((c) =>
    selected.has(c.id),
  ).length;
  const allChildrenSelected =
    group.connections.length > 0 &&
    childSelectedCount === group.connections.length;
  const someChildrenSelected =
    childSelectedCount > 0 && childSelectedCount < group.connections.length;

  const groupRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.indeterminate = someChildrenSelected;
    }
  }, [someChildrenSelected]);

  const groupLabel = `Group ${group.name}`;

  return (
    <div className="border-b border-border last:border-b-0">
      <label
        className={cn(
          "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs font-medium",
          "text-secondary-foreground hover:bg-muted",
        )}
      >
        <input
          ref={groupRef}
          type="checkbox"
          aria-label={groupLabel}
          aria-checked={
            someChildrenSelected
              ? "mixed"
              : allChildrenSelected
                ? "true"
                : "false"
          }
          checked={allChildrenSelected}
          onChange={(e) => onToggleGroup(e.target.checked)}
        />
        <span className="font-semibold text-foreground">{group.name}</span>
        <span className="text-muted-foreground">
          ({childSelectedCount}/{group.connections.length})
        </span>
      </label>
      <div className="pl-4">
        {group.connections.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-secondary-foreground hover:bg-muted"
          >
            <input
              type="checkbox"
              aria-label={c.name}
              checked={selected.has(c.id)}
              onChange={() => onToggleConnection(c.id)}
            />
            <span className="font-medium text-foreground">{c.name}</span>
            <span className="text-muted-foreground">
              ({c.db_type} @ {c.host}:{c.port})
            </span>
            {c.has_password && (
              <span className="ml-auto rounded bg-success/10 px-1.5 text-3xs font-medium text-success">
                pw set
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}
