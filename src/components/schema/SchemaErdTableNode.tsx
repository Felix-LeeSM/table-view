import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { type ErdTableFlowNode, useErdCanvasView } from "./erdCanvasContext";
import { erdSchemaToneIndex } from "./erdGraphModel";

/**
 * One badge tone per index of `erdSchemaToneIndex`. Written out as whole class
 * names because the Tailwind scanner reads source text, not runtime strings.
 */
const SCHEMA_TONE_CLASSES = [
  "bg-erd-schema-1/10 text-erd-schema-1",
  "bg-erd-schema-2/10 text-erd-schema-2",
  "bg-erd-schema-3/10 text-erd-schema-3",
  "bg-erd-schema-4/10 text-erd-schema-4",
] as const;

/**
 * Table card rendered inside a React Flow node. The card itself is the button:
 * clicking or activating it from the keyboard toggles the ERD selection, while
 * React Flow's node wrapper (role="group") owns dragging.
 */
export default function SchemaErdTableNode({
  id,
}: NodeProps<ErdTableFlowNode>) {
  const { t } = useTranslation("schema");
  const {
    tablesById,
    selectedTableId,
    relatedTableIds,
    searchMatchTableIds,
    onToggleSelect,
    registerTableButton,
  } = useErdCanvasView();
  const model = tablesById.get(id);
  if (!model) return null;

  const isSelected = selectedTableId === id;
  const isRelated = !selectedTableId || isSelected || relatedTableIds.has(id);
  const isSearchMatch = searchMatchTableIds
    ? searchMatchTableIds.has(id)
    : true;
  const toneClass =
    SCHEMA_TONE_CLASSES[erdSchemaToneIndex(model.table.schema)] ??
    SCHEMA_TONE_CLASSES[0];

  return (
    <button
      ref={(element) => registerTableButton(id, element)}
      type="button"
      aria-label={`${model.qualifiedName} table`}
      aria-pressed={isSelected}
      aria-current={isSelected ? "true" : undefined}
      data-related={isRelated}
      data-search-match={isSearchMatch}
      onClick={() => onToggleSelect(id)}
      style={{ width: model.width, height: model.height }}
      className={`flex flex-col overflow-hidden rounded border bg-card text-left shadow-sm transition-colors ${
        isSelected
          ? "border-primary ring-2 ring-primary/20"
          : isRelated
            ? "border-border hover:border-primary/60"
            : "border-border opacity-45 hover:border-primary/60"
      } ${
        searchMatchTableIds && isSearchMatch && !isSelected
          ? "ring-1 ring-primary/20"
          : ""
      }`}
    >
      {/* FK edges run referencing table -> referenced table, and elkjs stacks
          the referenced table above, so an edge leaves the top and lands on
          the bottom. */}
      <Handle
        type="source"
        position={Position.Top}
        isConnectable={false}
        className="opacity-0"
      />
      <Handle
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        className="opacity-0"
      />
      <div className="w-full border-b border-border bg-secondary px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className={`shrink-0 rounded px-1 text-3xs font-semibold uppercase ${toneClass}`}
          >
            {model.table.schema}
          </span>
          {isSelected && (
            <span className="rounded bg-primary/10 px-1 text-3xs font-semibold text-primary">
              {t("focused")}
            </span>
          )}
        </div>
        <div
          className="truncate text-sm font-semibold text-foreground"
          title={model.qualifiedName}
        >
          {model.qualifiedName}
        </div>
      </div>
      <div className="flex flex-1 flex-col py-1">
        {model.visibleColumns.map((column) => (
          <div
            key={column.id}
            className="grid grid-cols-[2.5rem_1fr] items-center gap-2 px-3 py-0.5 text-xs"
          >
            <span className="flex gap-1">
              {column.data.is_primary_key && (
                <span className="rounded bg-primary/10 px-1 text-3xs font-semibold text-primary">
                  PK
                </span>
              )}
              {column.data.is_foreign_key && (
                <span className="rounded bg-accent px-1 text-3xs font-semibold text-accent-foreground">
                  FK
                </span>
              )}
            </span>
            <span className="truncate text-foreground">{column.column}</span>
          </div>
        ))}
        {model.hiddenColumnCount > 0 && (
          <div className="px-3 py-0.5 text-xs text-muted-foreground">
            {t("moreColumns", { count: model.hiddenColumnCount })}
          </div>
        )}
      </div>
    </button>
  );
}
