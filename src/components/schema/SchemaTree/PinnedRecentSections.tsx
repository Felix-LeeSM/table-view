import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pin, PinOff, Table2, Clock, Eraser } from "lucide-react";
import { cn } from "@lib/utils";
import {
  useTableActivityStore,
  selectPinnedTables,
  selectRecentTables,
  type TableActivityEntry,
} from "@stores/tableActivityStore";
import type { RdbTreeShape } from "../treeShape";
import { formatTableRefLabel, formatTableRefTitle } from "./tableRefLabel";

/**
 * "Pinned" + "Recent" table sections pinned to the top of the relational
 * schema sidebar (#1218). Rows are plain `<button>`s so they are natively
 * keyboard-reachable with a single Tab and never interfere with the tree's
 * roving-tabindex model (#1129) — the sections live *outside* the
 * `role="tree"` container, so no new keymap is invented.
 *
 * Scope is the current `(connectionId, db)` so clicking a row opens in the
 * same db the tree is showing — i.e. the identical entry point as a tree node
 * click (`onOpenTable` is the SchemaTree's `handleTableClick`). Only the RDB
 * (SchemaTree) sidebar is in scope this PR; KV/search/document sidebars are a
 * follow-up (their paradigms differ).
 */

interface PinnedRecentSectionsProps {
  connectionId: string;
  db: string;
  treeShape: RdbTreeShape;
  /** Same handler the tree rows use — opens the records tab for the table. */
  onOpenTable: (table: string, schema: string) => void;
}

export function PinnedRecentSections({
  connectionId,
  db,
  treeShape,
  onOpenTable,
}: PinnedRecentSectionsProps) {
  const { t } = useTranslation("schema");
  const entries = useTableActivityStore((s) => s.entries);
  const togglePin = useTableActivityStore((s) => s.togglePin);
  const clearRecentTables = useTableActivityStore((s) => s.clearRecentTables);

  const pinned = useMemo(
    () => selectPinnedTables(entries, connectionId, db),
    [entries, connectionId, db],
  );
  // `selectRecentTables` already excludes pinned rows, so the Recent list
  // stays at its full `limit` and never double-lists a pinned table.
  const recent = useMemo(
    () => selectRecentTables(entries, connectionId, db),
    [entries, connectionId, db],
  );

  if (pinned.length === 0 && recent.length === 0) return null;

  const renderRow = (entry: TableActivityEntry, pinnedRow: boolean) => {
    const label = formatTableRefLabel(treeShape, entry.schema, entry.table);
    const title = formatTableRefTitle(entry.db, entry.schema, entry.table);
    return (
      <div
        key={`${pinnedRow ? "pin" : "recent"}:${entry.schema ?? ""}:${entry.table}`}
        className="group flex w-full items-center hover:bg-muted"
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-0.5 pl-3 pr-1 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={() => onOpenTable(entry.table, entry.schema ?? "")}
          title={title}
        >
          {pinnedRow ? (
            <Pin size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <Table2 size={12} className="shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm">{label}</span>
        </button>
        <button
          type="button"
          className={cn(
            "shrink-0 px-1.5 py-0.5 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            // Keyboard focus must reveal the hidden pin button, not just hover.
            pinnedRow
              ? ""
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          onClick={() =>
            togglePin({
              connectionId,
              db,
              schema: entry.schema,
              table: entry.table,
            })
          }
          aria-label={t(pinnedRow ? "unpinTableAria" : "pinTableAria", {
            table: entry.table,
          })}
          title={t(pinnedRow ? "unpinTableAria" : "pinTableAria", {
            table: entry.table,
          })}
        >
          {pinnedRow ? <PinOff size={12} /> : <Pin size={12} />}
        </button>
      </div>
    );
  };

  return (
    <div className="flex flex-col border-b border-border pb-1">
      {pinned.length > 0 && (
        <div>
          <div className="flex items-center gap-1 px-3 pt-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            <Pin size={10} />
            <span>{t("pinnedHeader")}</span>
          </div>
          {pinned.map((e) => renderRow(e, true))}
        </div>
      )}
      {recent.length > 0 && (
        <div>
          {/* product §1 — reset affordance for persistent Recent state lives on
              the sidebar section header. Pins keep their per-item unpin. */}
          <div className="group/hdr flex items-center gap-1 px-3 pt-1 text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            <Clock size={10} />
            <span>{t("recentHeader")}</span>
            <button
              type="button"
              className="ml-auto opacity-0 group-hover/hdr:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              onClick={() => clearRecentTables(connectionId, db)}
              aria-label={t("clearRecentTablesAria")}
              title={t("clearRecentTablesAria")}
            >
              <Eraser size={11} />
            </button>
          </div>
          {recent.map((e) => renderRow(e, false))}
        </div>
      )}
    </div>
  );
}
