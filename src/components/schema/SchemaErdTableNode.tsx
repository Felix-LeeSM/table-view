import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { type ErdTableFlowNode, useErdCanvasView } from "./erdCanvasContext";
import {
  ERD_TABLE_SOURCE_HANDLE_ID,
  ERD_TABLE_TARGET_HANDLE_ID,
  erdCardShape,
  erdColumnHandleId,
} from "./erdGraphModel";

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
    detailLevel,
    selectedTableId,
    relatedTableIds,
    searchMatchTableIds,
    onToggleSelect,
    registerTableButton,
  } = useErdCanvasView();
  const model = tablesById.get(id);
  if (!model) return null;

  // ADR 0054 (2): the zoom step decides how much of the table a card spells
  // out. The card shrinks inside the slot elkjs reserved; it never moves.
  const card = erdCardShape(model, detailLevel);
  const isSelected = selectedTableId === id;
  const isRelated = !selectedTableId || isSelected || relatedTableIds.has(id);
  const isSearchMatch = searchMatchTableIds
    ? searchMatchTableIds.has(id)
    : true;
  const toneClass =
    SCHEMA_TONE_CLASSES[model.schemaToneIndex] ?? SCHEMA_TONE_CLASSES[0];
  // The detail level decides which rows exist, so which anchors need the
  // card-level fallback changes with zoom — read it off the card, not the model.
  const drawnColumns = new Set(
    card.visibleColumns.map((column) => column.column),
  );

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
      style={{ width: model.width, height: card.height }}
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
        id={ERD_TABLE_SOURCE_HANDLE_ID}
        type="source"
        position={Position.Top}
        isConnectable={false}
        className="opacity-0"
      />
      <Handle
        id={ERD_TABLE_TARGET_HANDLE_ID}
        type="target"
        position={Position.Bottom}
        isConnectable={false}
        className="opacity-0"
      />
      {/* An anchor for a column this card is not drawing still has to exist:
          React Flow drops an edge whose handle id it cannot find. Rendering it
          at card level keeps the edge attached to the card edge instead. */}
      {model.anchorColumns
        .filter((column) => !drawnColumns.has(column))
        .map((column) => (
          <ErdColumnAnchor key={column} column={column} />
        ))}
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
        {card.visibleColumns.map((column) => (
          <div
            key={column.id}
            className="relative grid grid-cols-[2.5rem_1fr] items-center gap-2 px-3 py-0.5 text-xs"
          >
            {model.anchorColumns.includes(column.column) && (
              <ErdColumnAnchor column={column.column} />
            )}
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
        {card.hiddenColumnCount > 0 && (
          <div className="px-3 py-0.5 text-xs text-muted-foreground">
            {t("hiddenColumns", { count: card.hiddenColumnCount })}
          </div>
        )}
      </div>
    </button>
  );
}

/**
 * Where an FK edge attaches for one column. Rendered inside the column row, so
 * the browser decides the exact spot and no copy of the row geometry can drift
 * from the CSS. The row is the positioning context (`relative`); the same pair
 * rendered at card level falls back to the card edge.
 */
function ErdColumnAnchor({ column }: { column: string }) {
  return (
    <>
      <Handle
        id={erdColumnHandleId("target", column)}
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="opacity-0"
      />
      <Handle
        id={erdColumnHandleId("source", column)}
        type="source"
        position={Position.Right}
        isConnectable={false}
        className="opacity-0"
      />
    </>
  );
}
