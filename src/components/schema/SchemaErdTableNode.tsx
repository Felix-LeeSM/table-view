import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Minus, Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SchemaGraphDiffChangeKind } from "@/lib/schemaGraphDiff";
import { type ErdTableFlowNode, useErdCanvasView } from "./erdCanvasContext";
import { erdDiffTableKinds } from "./erdDiffHighlight";

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
 * Diff marks carry three channels per change kind — hue, icon shape, and the
 * card outline's line pattern — so the kind survives a greyscale or
 * colour-blind reading (ADR 0054 decision 6 bans colour-only encoding). Whole
 * class names for the same Tailwind-scanner reason as the tones above.
 */
const DIFF_KIND_PRESENTATION = {
  added: {
    Icon: Plus,
    labelKey: "added",
    badgeClass: "bg-success/10 text-success",
    outlineClass: "outline outline-2 outline-offset-1 outline-success",
  },
  removed: {
    Icon: Minus,
    labelKey: "removed",
    badgeClass: "bg-destructive/10 text-destructive",
    outlineClass:
      "outline outline-2 outline-dashed outline-offset-1 outline-destructive",
  },
  changed: {
    Icon: Pencil,
    labelKey: "changed",
    badgeClass: "bg-warning/10 text-warning",
    outlineClass:
      "outline outline-2 outline-dotted outline-offset-1 outline-warning",
  },
} as const satisfies Record<
  SchemaGraphDiffChangeKind,
  {
    Icon: typeof Plus;
    labelKey: string;
    badgeClass: string;
    outlineClass: string;
  }
>;

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
    diffHighlight,
  } = useErdCanvasView();
  const model = tablesById.get(id);
  if (!model) return null;

  const isSelected = selectedTableId === id;
  const isRelated = !selectedTableId || isSelected || relatedTableIds.has(id);
  const isSearchMatch = searchMatchTableIds
    ? searchMatchTableIds.has(id)
    : true;
  const toneClass =
    SCHEMA_TONE_CLASSES[model.schemaToneIndex] ?? SCHEMA_TONE_CLASSES[0];
  const diffKinds = erdDiffTableKinds(diffHighlight, id);
  // Outline follows the first kind: a brand-new table reads as new even when its
  // own columns also register as additions.
  const diffOutlineClass = diffKinds[0]
    ? DIFF_KIND_PRESENTATION[diffKinds[0]].outlineClass
    : "";

  return (
    <button
      ref={(element) => registerTableButton(id, element)}
      type="button"
      aria-label={`${model.qualifiedName} table`}
      aria-pressed={isSelected}
      aria-current={isSelected ? "true" : undefined}
      data-related={isRelated}
      data-search-match={isSearchMatch}
      data-diff-kinds={diffKinds.length > 0 ? diffKinds.join(" ") : undefined}
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
      } ${diffOutlineClass}`}
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
          {diffKinds.map((kind) => (
            <ErdDiffMark key={kind} kind={kind} />
          ))}
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
            className="grid grid-cols-[2.5rem_1fr_auto] items-center gap-2 px-3 py-0.5 text-xs"
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
            <ErdColumnDiffMark
              kind={diffHighlight.columns.get(column.id)}
              columnName={column.column}
            />
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

/** Change-kind mark on the card header. Icon shape carries the kind, not hue. */
function ErdDiffMark({ kind }: { kind: SchemaGraphDiffChangeKind }) {
  const { t } = useTranslation("schema");
  const { Icon, labelKey, badgeClass } = DIFF_KIND_PRESENTATION[kind];
  const label = t("erdDiffTableMark", { kind: t(labelKey) });

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex shrink-0 items-center rounded px-0.5 py-0.5 ${badgeClass}`}
    >
      <Icon size={10} aria-hidden="true" />
    </span>
  );
}

/**
 * Change-kind mark on one column row. Renders nothing for an untouched column —
 * and for a column the comparison dropped, which the current schema has no row
 * for at all (see `erdDiffHighlight`).
 */
function ErdColumnDiffMark({
  kind,
  columnName,
}: {
  kind: SchemaGraphDiffChangeKind | undefined;
  columnName: string;
}) {
  const { t } = useTranslation("schema");
  if (!kind) return null;

  const { Icon, labelKey, badgeClass } = DIFF_KIND_PRESENTATION[kind];
  const label = t("erdDiffColumnMark", {
    column: columnName,
    kind: t(labelKey),
  });

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`flex shrink-0 items-center rounded px-0.5 ${badgeClass}`}
    >
      <Icon size={9} aria-hidden="true" />
    </span>
  );
}
