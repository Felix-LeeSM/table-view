// Presentational outer chrome shared by both paradigm bodies
// (`RdbQuickLookBody`, `DocumentQuickLookBody`):
//
//   * panel container (`role="region"` + configurable `aria-label`,
//     `border-t border-border bg-background`, `style={{ height }}`). #1734 (5)
//     made it a programmatic focus target (`tabIndex={-1}` + `panelRef`) with a
//     visible `--color-ring` outline, so `F6` can hand focus to the panel and
//     the user can see that it landed there,
//   * keyboard-accessible resize handle (`role="separator"`, `tabIndex=0`,
//     `aria-orientation="horizontal"`, `aria-valuemin={120}` /
//     `aria-valuemax={600}` / `aria-valuenow={height}`,
//     `aria-label="Resize Quick Look panel"`, `GripHorizontal` icon,
//     `cursor-row-resize`, `hover:bg-muted`,
//     `focus-visible:outline-1 focus-visible:outline-ring`),
//   * header bar (title node + inline `HeaderControls`: dirty pill + optional
//     Edit toggle + Close button),
//   * children slot for the body content.
//
// The Edit toggle is opt-in (#1734 (4)): it renders only for a body that
// passes `onToggleEdit`. RDB dropped it — its fields are always editable when
// `editState` is present. Document mode keeps it because there the control is
// a *view* switch (BSON tree ↔ field list), not an edit on/off switch, and
// dropping it would delete the nested-document read view.
//
// The shell holds NO paradigm-specific decisions: no RDB-vs-document
// branching, no ownership of `editState` or `height`. Resize handle styling
// is unified across paradigms via the optional
// `resizeHandleClassName` prop so the document body can preserve its
// existing `dark:bg-muted/20` variant byte-for-byte.

import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import { Button } from "@components/ui/button";
import { cn } from "@lib/utils";
import { GripHorizontal, Pencil, PencilOff, X } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";
import { MAX_HEIGHT, MIN_HEIGHT } from "./helpers";

export interface QuickLookShellProps {
  /** Region label that screen-readers announce when focus enters the panel. */
  regionLabel: "Row Details" | "Document Details";
  /** Panel height in pixels (clamped to `[MIN_HEIGHT, MAX_HEIGHT]`). */
  height: number;
  onResizeMouseDown: (e: MouseEvent) => void;
  onResizeKeyDown: (e: KeyboardEvent) => void;
  /**
   * Optional override for the resize handle classes. Defaults to the RDB
   * variant. Document mode preserves its existing `dark:bg-muted/20` by
   * passing the document-flavor class string here.
   */
  resizeHandleClassName?: string;
  /** Title node (Row Details / Document Details + namespace label + suffix). */
  title: ReactNode;
  /** Per-mode close button accessible label. */
  closeLabel: "Close row details" | "Close document details";
  isDirty: boolean;
  /**
   * Edit toggle. Both are required together — omit them (RDB, #1734 (4)) and
   * no toggle renders; supply them (document view switch) and it does.
   */
  editing?: boolean;
  onToggleEdit?: () => void;
  onClose: () => void;
  /** Optional — gates the Edit toggle together with `onToggleEdit`. */
  editState?: DataGridEditState;
  /** `F6` focus target (#1734 (5)) — see `useQuickLookFocus`. */
  panelRef?: RefObject<HTMLDivElement | null>;
  /** Body content (FieldRow list / BSON tree / etc.). */
  children: ReactNode;
}

const DEFAULT_RESIZE_HANDLE =
  "flex h-2 cursor-row-resize items-center justify-center border-b border-border bg-muted/30 hover:bg-muted focus-visible:outline-1 focus-visible:outline-ring";

export default function QuickLookShell({
  regionLabel,
  height,
  onResizeMouseDown,
  onResizeKeyDown,
  resizeHandleClassName,
  title,
  closeLabel,
  isDirty,
  editing,
  onToggleEdit,
  onClose,
  editState,
  panelRef,
  children,
}: QuickLookShellProps) {
  const { t } = useTranslation("shared");
  return (
    <div
      ref={panelRef}
      className="flex shrink-0 flex-col border-t border-border bg-background focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      style={{ height }}
      role="region"
      aria-label={regionLabel}
      // #1734 (5) — not in the tab order (the grid keeps its single cell tab
      // stop); `F6` moves focus here programmatically.
      tabIndex={-1}
    >
      {/* Resize handle */}
      <div
        className={cn(DEFAULT_RESIZE_HANDLE, resizeHandleClassName)}
        onMouseDown={onResizeMouseDown}
        onKeyDown={onResizeKeyDown}
        tabIndex={0}
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("shell.resizeLabel")}
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={height}
      >
        <GripHorizontal className="h-3 w-3 text-muted-foreground" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-1">
          {isDirty && (
            <span className="rounded bg-warning/15 px-1.5 py-0.5 text-3xs font-semibold text-warning">
              {t("shell.modified")}
            </span>
          )}
          {editState && onToggleEdit && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t("shell.toggleEdit")}
              aria-pressed={editing}
              title={editing ? t("shell.exitEdit") : t("shell.enterEdit")}
              onClick={onToggleEdit}
            >
              {editing ? <PencilOff /> : <Pencil />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={
              closeLabel === "Close row details"
                ? t("rowDetails.closeLabel")
                : t("documentDetails.closeLabel")
            }
          >
            <X />
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
