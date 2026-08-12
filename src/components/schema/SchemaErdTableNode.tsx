import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Minus, Pencil, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SchemaGraphDiffChangeKind } from "@/lib/schemaGraphDiff";
import { type ErdTableFlowNode, useErdCanvasView } from "./erdCanvasContext";
import { erdDiffTableKinds } from "./erdDiffHighlight";
import { erdCardShape } from "./erdGraphModel";

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
 * Presentation per change kind. A badge pairs a hue with its own icon shape and
 * the card outline pairs the same hue with its own line pattern, so either mark
 * survives a greyscale or colour-blind reading (ADR 0054 decision 6 bans
 * colour-only encoding). Whole class names for the same Tailwind-scanner reason
 * as the tones above.
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
    detailLevel,
    selectedTableId,
    relatedTableIds,
    searchMatchTableIds,
    onToggleSelect,
    registerTableButton,
    diffHighlight,
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
  const diffKinds = erdDiffTableKinds(diffHighlight, id);
  // The badges list every kind that touched the table. The outline instead
  // follows the entry for the table *itself*, which is the only channel that
  // separates a brand-new table (solid `added`) from a surviving one that just
  // gained a column (dotted `changed`) — both carry an `added` badge.
  const tableSelfKind = diffHighlight.tableSelfKinds.get(id);
  const diffOutlineClass = tableSelfKind
    ? DIFF_KIND_PRESENTATION[tableSelfKind].outlineClass
    : "";
  // `button` is children-presentational in ARIA, so the accessibility tree drops
  // the marks' own labels below. The card's name has to repeat the kinds — the
  // workaround `ConnectionItem` already uses for its row status word.
  const diffKindLabel = diffKinds
    .map((kind) => t(DIFF_KIND_PRESENTATION[kind].labelKey))
    .join(", ");
  const cardLabel = diffKindLabel
    ? `${model.qualifiedName} table, ${t("erdDiffTableMark", { kind: diffKindLabel })}`
    : `${model.qualifiedName} table`;
  // The diff outline is author-origin and unconditional, so it would paint over
  // the UA focus ring on a card `SchemaErdCanvas` focuses programmatically. The
  // card carries the same `focus-visible` ring the schema tree rows use.

  return (
    <button
      ref={(element) => registerTableButton(id, element)}
      type="button"
      aria-label={cardLabel}
      aria-pressed={isSelected}
      aria-current={isSelected ? "true" : undefined}
      data-related={isRelated}
      data-search-match={isSearchMatch}
      data-diff-kinds={diffKinds.length > 0 ? diffKinds.join(" ") : undefined}
      onClick={() => onToggleSelect(id)}
      style={{ width: model.width, height: card.height }}
      className={`flex flex-col overflow-hidden rounded border bg-card text-left shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
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
        {card.visibleColumns.map((column) => (
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
 * Change-kind mark on the card header. The icon shape carries the kind, so hue
 * is never the only channel. The accessibility tree drops this `aria-label` —
 * `button` is children-presentational — so the card's own name repeats the kinds
 * and this one stays for the hover `title`.
 */
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
 * Change-kind mark on one column row. Renders nothing for an untouched column.
 * Two touched columns get no row to mark at all: one the comparison dropped, so
 * the current schema has none (see `erdDiffHighlight`), and one the zoom step
 * left out of the card (`erdCardShape`), which the hidden-columns line only
 * counts.
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
