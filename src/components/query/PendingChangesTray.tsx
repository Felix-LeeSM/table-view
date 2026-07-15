import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { QueryResult } from "@/types/query";
import { cellToEditString, editKey } from "@components/datagrid";
import { buildRawEditSql, type RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";
import { coerceToSqlLiteral } from "@lib/sql/sqlLiteral";

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
  /**
   * For an empty `newValue`, whether the generated SQL collapses it to NULL
   * (non-textual column) or preserves it as `''` (textual column, issue #1436).
   * Lets the tray label match the emitted literal instead of always showing
   * NULL.
   */
  emptyAsNull: boolean;
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
    const coerced = coerceToSqlLiteral(
      newValue,
      plan.resultColumnTypes?.[colIdx] ?? "",
      plan.dialect,
    );
    entries.push({
      kind: "edit",
      key,
      column: colName,
      oldDisplay: oldCell == null ? "NULL" : cellToEditString(oldCell),
      newValue,
      emptyAsNull: coerced.kind === "sql" && coerced.sql === "NULL",
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
  const { t } = useTranslation("query");
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
      aria-label={t("pendingChanges.regionAria")}
    >
      <div className="border-b border-border px-3 py-1 text-xs font-medium text-foreground">
        {t("pendingChanges.summary", { total, plural: total !== 1 ? "s" : "" })}
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
                        title={t(
                          entry.emptyAsNull
                            ? "pendingChanges.nullInputTitle"
                            : "pendingChanges.emptyStringInputTitle",
                        )}
                      >
                        {entry.emptyAsNull ? "NULL" : "''"}
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
                      aria-label={t("pendingChanges.revertEditAria", {
                        column: entry.column,
                      })}
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
                      aria-label={t("pendingChanges.revertDeleteAria", {
                        pkLabel: entry.pkLabel,
                      })}
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
