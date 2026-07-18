import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import type {
  KvHashValue,
  KvListValue,
  KvSetValue,
  KvZSetValue,
} from "@/types/kv";
import {
  type KvEntryPayload,
  treeWriteTargetForEntry,
} from "./kvMutationCommands";
import { KvJsonValueCell } from "./KvJsonValueCell";
import { formatCount } from "./kvValueFormat";

// Structured render for Redis collection values (#1465). The envelope arrives
// pre-bounded by the backend read limit, so this table only ever renders one
// bounded page; truncation is disclosed in the footer. When `onEntryAction` is
// supplied (mutation enabled + fully loaded, #1415) each row gains inline edit/
// delete that ride the KvMutationPanel gate. Command building stays in the panel.
//
// PR4 (2026-07-18) — when `writeContext` is supplied (same mutable gate as
// `onEntryAction`), the value cell of a hash field / list element whose value is
// JSON becomes a tree editor that writes the whole re-serialized value via
// HSET/LSET. Set members and zSet entries are out of scope (PR5).

export type KvCollectionValue =
  | KvHashValue
  | KvListValue
  | KvSetValue
  | KvZSetValue;

export interface KvCollectionWriteContext {
  connectionId: string;
  database: number;
  onWriteSuccess: (key: string) => Promise<void> | void;
}

export interface KvCollectionValueTableProps {
  keyName: string;
  value: KvCollectionValue;
  onEntryAction?: (op: "edit" | "delete", payload: KvEntryPayload) => void;
  writeContext?: KvCollectionWriteContext;
}

interface CollectionRow {
  key: string;
  /** First cell doubles as the row's action label (field / index / member). */
  cells: string[];
  payload: KvEntryPayload;
}

interface CollectionRows {
  /** i18n column-label keys under workspace:kvCollection. */
  columns: string[];
  rows: CollectionRow[];
  /** Set members are immutable strings — delete only, no edit. */
  editable: boolean;
}

function toRows(value: KvCollectionValue): CollectionRows {
  switch (value.type) {
    case "hash":
      return {
        columns: ["colField", "colValue"],
        editable: true,
        rows: value.fields.map((field, index) => ({
          key: `${index}:${field.field}`,
          cells: [field.field, field.value],
          payload: { kind: "hash", field: field.field, value: field.value },
        })),
      };
    case "list":
      return {
        columns: ["colIndex", "colValue"],
        editable: true,
        rows: value.entries.map((entry) => ({
          key: String(entry.index),
          cells: [String(entry.index), entry.value],
          payload: { kind: "list", index: entry.index, value: entry.value },
        })),
      };
    case "set":
      return {
        columns: ["colMember"],
        editable: false,
        rows: value.members.map((member, index) => ({
          key: `${index}:${member}`,
          cells: [member],
          payload: { kind: "set", member },
        })),
      };
    case "zSet":
      return {
        columns: ["colMember", "colScore"],
        editable: true,
        rows: value.entries.map((entry, index) => ({
          key: `${index}:${entry.member}`,
          cells: [entry.member, String(entry.score)],
          payload: { kind: "zSet", member: entry.member, score: entry.score },
        })),
      };
  }
}

export function KvCollectionValueTable({
  keyName,
  value,
  onEntryAction,
  writeContext,
}: KvCollectionValueTableProps) {
  const { t } = useTranslation("workspace");
  const { columns, rows, editable } = toRows(value);
  const showActions = Boolean(onEntryAction);
  const colSpan = columns.length + (showActions ? 1 : 0);

  return (
    <div className="rounded border border-border bg-muted/20">
      <div className="max-h-96 overflow-auto">
        <table
          className="w-full table-fixed text-left text-3xs"
          aria-label={t("kvCollection.tableAria", {
            key: keyName,
            type: value.type,
          })}
        >
          <thead className="sticky top-0 bg-muted text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-2 py-1 font-medium">
                  {t(`kvCollection.${column}`)}
                </th>
              ))}
              {showActions && (
                <th className="w-16 px-2 py-1 text-right font-medium">
                  {t("kvCollection.colActions")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border">
                {row.cells.map((cell, cellIndex) => {
                  // Only the value column (last cell) of a mutable hash/list row
                  // is JSON-editable; the field/index cell and set/zSet stay
                  // read-only (treeWriteTargetForEntry returns null for those).
                  const isValueCell = cellIndex === row.cells.length - 1;
                  const target =
                    writeContext && isValueCell
                      ? treeWriteTargetForEntry(keyName, row.payload)
                      : null;
                  return (
                    <td
                      key={cellIndex}
                      className="px-2 py-1 align-top font-mono break-all text-foreground"
                    >
                      <KvJsonValueCell
                        value={cell}
                        label={row.cells[0] ?? ""}
                        edit={
                          target && writeContext
                            ? { target, ...writeContext }
                            : undefined
                        }
                      />
                    </td>
                  );
                })}
                {showActions && onEntryAction && (
                  <td className="px-2 py-1 text-right align-top whitespace-nowrap">
                    {editable && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t("kvCollection.editEntry", {
                          label: row.cells[0],
                        })}
                        onClick={() => onEntryAction("edit", row.payload)}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-destructive"
                      aria-label={t("kvCollection.deleteEntry", {
                        label: row.cells[0],
                      })}
                      onClick={() => onEntryAction("delete", row.payload)}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={colSpan}
                  className="border-t border-border px-2 py-3 text-muted-foreground"
                >
                  {t("kvCollection.noEntries")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length < value.total && (
        <div className="border-t border-border px-2 py-1 text-3xs text-muted-foreground">
          {t("kvCollection.truncated", {
            shown: formatCount(rows.length),
            total: formatCount(value.total),
          })}
        </div>
      )}
    </div>
  );
}
