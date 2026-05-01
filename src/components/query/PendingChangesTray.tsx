import { X } from "lucide-react";
import type { QueryResult } from "@/types/query";
import {
  cellToEditString,
  editKey,
} from "@components/datagrid/useDataGridEdit";
import { buildRawEditSql, type RawEditPlan } from "@lib/rawQuerySqlBuilder";

export interface PendingChangesTrayProps {
  result: QueryResult;
  pendingEdits: Map<string, string>;
  pendingDeletedRowKeys: Set<string>;
  plan: RawEditPlan;
  onRevertEdit: (key: string) => void;
  onRevertDelete: (rowKey: string) => void;
}

interface EditEntry {
  kind: "edit";
  key: string;
  column: string;
  oldDisplay: string;
  newValue: string;
  sql: string;
}

interface DeleteEntry {
  kind: "delete";
  rowKey: string;
  pkLabel: string;
  sql: string;
}

type Entry = EditEntry | DeleteEntry;

function buildEntries(
  result: QueryResult,
  pendingEdits: Map<string, string>,
  pendingDeletedRowKeys: Set<string>,
  plan: RawEditPlan,
): Entry[] {
  const entries: Entry[] = [];

  pendingEdits.forEach((newValue, key) => {
    const [rowStr, colStr] = key.split("-");
    const rowIdx = parseInt(rowStr!, 10);
    const colIdx = parseInt(colStr!, 10);
    const colName = plan.resultColumnNames[colIdx];
    const row = result.rows[rowIdx];
    if (!colName || !row) return;
    const oldCell = row[colIdx];
    const single = new Map<string, string>([[key, newValue]]);
    const [sql] = buildRawEditSql(result.rows, single, new Set(), plan);
    entries.push({
      kind: "edit",
      key,
      column: colName,
      oldDisplay: oldCell == null ? "NULL" : cellToEditString(oldCell),
      newValue,
      sql: sql ?? "",
    });
  });

  pendingDeletedRowKeys.forEach((rowKey) => {
    const parts = rowKey.split("-");
    const rowIdx = parseInt(parts[2]!, 10);
    const row = result.rows[rowIdx];
    if (!row) return;
    const pkLabel = plan.pkColumns
      .map((pk) => {
        const idx = plan.resultColumnNames.indexOf(pk);
        const value = row[idx];
        return `${pk}=${value == null ? "NULL" : String(value)}`;
      })
      .join(", ");
    const [sql] = buildRawEditSql(
      result.rows,
      new Map(),
      new Set([rowKey]),
      plan,
    );
    entries.push({
      kind: "delete",
      rowKey,
      pkLabel,
      sql: sql ?? "",
    });
  });

  return entries;
}

/**
 * Read-only tray listing each pending edit / delete with its generated
 * SQL. Stateless: all mutation flows back through `onRevertEdit` /
 * `onRevertDelete` callbacks so the parent (`EditableQueryResultGrid`)
 * stays the single source of truth for pending state. Returns `null`
 * when there is nothing to show so the parent's layout stays clean.
 */
export default function PendingChangesTray({
  result,
  pendingEdits,
  pendingDeletedRowKeys,
  plan,
  onRevertEdit,
  onRevertDelete,
}: PendingChangesTrayProps) {
  const total = pendingEdits.size + pendingDeletedRowKeys.size;
  if (total === 0) return null;

  const entries = buildEntries(
    result,
    pendingEdits,
    pendingDeletedRowKeys,
    plan,
  );

  return (
    <div
      className="border-t border-border bg-muted/30"
      role="region"
      aria-label="Pending changes"
    >
      <div className="border-b border-border px-3 py-1 text-xs font-medium text-foreground">
        {total} change{total !== 1 ? "s" : ""} pending
      </div>
      <div className="max-h-48 overflow-y-auto">
        <table className="w-full text-xs">
          <tbody>
            {entries.map((entry) =>
              entry.kind === "edit" ? (
                <tr
                  key={entry.key}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="w-32 truncate px-3 py-1 font-mono text-muted-foreground">
                    {entry.column}
                  </td>
                  <td className="w-32 truncate px-3 py-1 line-through text-muted-foreground">
                    {entry.oldDisplay}
                  </td>
                  <td className="w-32 truncate px-3 py-1">
                    {entry.newValue === "" ? (
                      <span
                        className="italic text-muted-foreground"
                        title="Empty input is treated as SQL NULL"
                      >
                        NULL
                      </span>
                    ) : (
                      entry.newValue
                    )}
                  </td>
                  <td className="px-3 py-1">
                    <code
                      className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-foreground"
                      title={entry.sql}
                    >
                      {entry.sql}
                    </code>
                  </td>
                  <td className="w-8 px-2 py-1 text-right">
                    <button
                      type="button"
                      aria-label={`Revert ${entry.column}`}
                      onClick={() => onRevertEdit(entry.key)}
                      className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ) : (
                <tr
                  key={entry.rowKey}
                  className="border-b border-border last:border-b-0"
                >
                  <td className="w-32 truncate px-3 py-1 font-mono text-destructive">
                    DELETE
                  </td>
                  <td
                    className="w-32 truncate px-3 py-1 text-muted-foreground"
                    colSpan={2}
                  >
                    {entry.pkLabel}
                  </td>
                  <td className="px-3 py-1">
                    <code
                      className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-foreground"
                      title={entry.sql}
                    >
                      {entry.sql}
                    </code>
                  </td>
                  <td className="w-8 px-2 py-1 text-right">
                    <button
                      type="button"
                      aria-label={`Revert delete row ${entry.pkLabel}`}
                      onClick={() => onRevertDelete(entry.rowKey)}
                      className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { editKey };
