import { X, Table2, Code2, Leaf } from "lucide-react";
import { type Tab, type TableTab } from "@stores/workspaceStore";
import { Button } from "@components/ui/button";
import type { TabDragHandlers } from "./useTabDrag";

export interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  isDirty: boolean;
  isDragging: boolean;
  /**
   * Label shown in the tab. Computed by the parent because
   * disambiguation depends on every open tab (same-name tables across
   * connections get the schema prefix). TabItem is purely presentational.
   */
  displayTitle: string;
  /** Fires on left-click and on Enter / Space. */
  onActivate: () => void;
  /**
   * Fires on double-click. Parent decides whether to promote a preview
   * table tab; non-preview tabs get a no-op callback.
   */
  onPromote: () => void;
  /** Fires on close-button click or middle-click. */
  onRequestClose: () => void;
  /** Pointer handlers minted by `useTabDrag`. Spread onto the root div. */
  dragHandlers: TabDragHandlers;
}

export default function TabItem({
  tab,
  isActive,
  isDirty,
  isDragging,
  displayTitle,
  onActivate,
  onPromote,
  onRequestClose,
  dragHandlers,
}: TabItemProps) {
  const isPreviewTable =
    tab.type === "table" && (tab as TableTab).isPreview === true;

  return (
    <div
      role="tab"
      data-tab-id={tab.id}
      data-preview={isPreviewTable ? "true" : undefined}
      aria-selected={isActive}
      tabIndex={isActive ? 0 : -1}
      // Compact tab metrics. `py-1 text-sm` keeps the row ≤ 32px
      // (≈20px line-height + 8px padding + 1px border) while leaving
      // the close button (`size-6` = 24px) inside a comfortable hit
      // target. `text-xs` would tighten things further but drop the
      // close button below the ADR 0008 accessibility floor.
      className={`group relative flex items-center gap-1.5 border-r border-border pl-3 pr-1.5 py-1 text-sm cursor-pointer select-none transition-opacity ${
        isActive
          ? "bg-background text-foreground border-b-2 border-b-primary"
          : "text-secondary-foreground hover:bg-muted"
      } ${isDragging ? "opacity-50" : ""}`}
      onClick={onActivate}
      onDoubleClick={onPromote}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onRequestClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      {...dragHandlers}
    >
      {tab.type === "query" ? (
        <Code2 size={12} className="shrink-0 text-muted-foreground" />
      ) : (
        <Table2 size={12} className="shrink-0 text-muted-foreground" />
      )}
      {tab.paradigm === "document" && (
        <Leaf
          size={10}
          className="shrink-0 text-muted-foreground"
          aria-label={
            tab.type === "table"
              ? "MongoDB collection tab"
              : "MongoDB query tab"
          }
        />
      )}
      <span
        className={`max-w-30 truncate${isPreviewTable ? " italic opacity-70" : ""}`}
      >
        {displayTitle}
      </span>
      {isDirty && (
        <span
          aria-label="Unsaved changes"
          data-dirty="true"
          title="Unsaved changes"
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      )}
      {tab.closable && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${tab.title}`}
          // 2026-05-11 — active tab always exposes the close affordance;
          // inactive tabs reveal it on hover/focus so the strip stays
          // visually quiet. Pre-fix the active tab also hid the X
          // behind a hover gate which conflicted with "the tab I'm
          // looking at should be closable without aiming first".
          className={
            isActive
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }
          onClick={(e) => {
            e.stopPropagation();
            onRequestClose();
          }}
        >
          <X size={12} />
        </Button>
      )}
    </div>
  );
}
