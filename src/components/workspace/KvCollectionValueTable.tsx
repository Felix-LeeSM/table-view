import { useTranslation } from "react-i18next";
import type {
  KvHashValue,
  KvListValue,
  KvSetValue,
  KvZSetValue,
} from "@/types/kv";
import { formatCount } from "./kvValueFormat";

// Read-only structured render for Redis collection values (#1465). The
// envelope arrives pre-bounded by the backend read limit, so this table only
// ever renders one bounded page; truncation is disclosed in the footer.
// Mutation stays in KvMutationPanel (#1466).

export type KvCollectionValue =
  | KvHashValue
  | KvListValue
  | KvSetValue
  | KvZSetValue;

export interface KvCollectionValueTableProps {
  keyName: string;
  value: KvCollectionValue;
}

interface CollectionRows {
  /** i18n column-label keys under workspace:kvCollection. */
  columns: string[];
  rows: { key: string; cells: string[] }[];
}

function toRows(value: KvCollectionValue): CollectionRows {
  switch (value.type) {
    case "hash":
      return {
        columns: ["colField", "colValue"],
        rows: value.fields.map((field, index) => ({
          key: `${index}:${field.field}`,
          cells: [field.field, field.value],
        })),
      };
    case "list":
      return {
        columns: ["colIndex", "colValue"],
        rows: value.entries.map((entry) => ({
          key: String(entry.index),
          cells: [String(entry.index), entry.value],
        })),
      };
    case "set":
      return {
        columns: ["colMember"],
        rows: value.members.map((member, index) => ({
          key: `${index}:${member}`,
          cells: [member],
        })),
      };
    case "zSet":
      return {
        columns: ["colMember", "colScore"],
        rows: value.entries.map((entry, index) => ({
          key: `${index}:${entry.member}`,
          cells: [entry.member, String(entry.score)],
        })),
      };
  }
}

export function KvCollectionValueTable({
  keyName,
  value,
}: KvCollectionValueTableProps) {
  const { t } = useTranslation("workspace");
  const { columns, rows } = toRows(value);

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
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-border">
                {row.cells.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className="px-2 py-1 align-top font-mono break-all text-foreground"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
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
