// Presentational outer chrome shared by both paradigm bodies
// (`RdbQuickLookBody`, `DocumentQuickLookBody`):
//
//   * panel container (`role="region"` + configurable `aria-label`,
//     `border-t border-border bg-background`, `style={{ height }}`),
//   * keyboard-accessible resize handle (`role="separator"`, `tabIndex=0`,
//     `aria-orientation="horizontal"`, `aria-valuemin={120}` /
//     `aria-valuemax={600}` / `aria-valuenow={height}`,
//     `aria-label="Resize Quick Look panel"`, `GripHorizontal` icon,
//     `cursor-row-resize`, `hover:bg-muted`,
//     `focus-visible:outline-1 focus-visible:outline-ring`),
//   * header bar (title node + inline `HeaderControls`: dirty pill + Edit
//     toggle + Close button),
//   * children slot for the body content.
//
// The shell holds NO paradigm-specific decisions: no RDB-vs-document
// branching, no ownership of `editState` or `height`. Resize handle styling
// is unified across paradigms via the optional
// `resizeHandleClassName` prop so the document body can preserve its
// existing `dark:bg-muted/20` variant byte-for-byte.
import { X, GripHorizontal, Pencil, PencilOff } from "lucide-react";
import type { ReactNode, MouseEvent, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { cn } from "@lib/utils";
import { MIN_HEIGHT, MAX_HEIGHT } from "./helpers";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";

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
  editing: boolean;
  onToggleEdit: () => void;
  onClose: () => void;
  /** Optional — when present, the Edit toggle is rendered. */
  editState?: DataGridEditState;
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
  children,
}: QuickLookShellProps) {
  const { t } = useTranslation("shared");
  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-background"
      style={{ height }}
      role="region"
      aria-label={regionLabel}
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
          {editState && (
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
