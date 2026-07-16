// Presentational sub-components for DocumentTreePanel: the virtualized row
// window, the `+ key` / `+ item` add rows, the inline leaf editor, and the
// small stat/tag/new badges. All are state-free — the panel drives them via
// props so only one add UI is visible across the whole tree at a time.

import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Plus } from "lucide-react";
import { type RenderRow, renderRowKey } from "./types";

// #1448 — windowed row list with top/bottom `aria-hidden` spacers that keep the
// scroll height while only the visible slice lives in the DOM. Mirrors
// `BsonTreeViewer`'s `VirtualBsonRows` (no `scrollMargin` — the `role="tree"`
// div is itself the scroll container with no header above the list).
export function VirtualTreeRows({
  renderRows,
  virtualizer,
  children,
}: {
  renderRows: RenderRow[];
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  children: (row: RenderRow) => React.ReactNode;
}) {
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length ? virtualItems[0]!.start : 0;
  const paddingBottom = virtualItems.length
    ? totalSize - virtualItems[virtualItems.length - 1]!.end
    : 0;
  return (
    <div style={{ position: "relative" }}>
      {paddingTop > 0 && (
        <div aria-hidden="true" style={{ height: paddingTop }} />
      )}
      {virtualItems.map((virtualRow) => {
        const row = renderRows[virtualRow.index]!;
        return (
          <div
            key={renderRowKey(row)}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
          >
            {children(row)}
          </div>
        );
      })}
      {paddingBottom > 0 && (
        <div aria-hidden="true" style={{ height: paddingBottom }} />
      )}
    </div>
  );
}

// Sprint 344 Slice B (2026-05-15) — `+ key` row. Two render branches:
//  1. Closed: a small dashed-button affordance ("+ key") that opens
//     the input pair on click.
//  2. Open: key + value inputs side-by-side at the parent's child
//     indent. Tab/Shift+Tab move focus between them (browser default
//     handles this — the ref-driven focus calls below are jsdom
//     fallbacks). Enter commits, Esc cancels. Validation message
//     renders inline below the inputs with aria-live="polite".
//
// The component is intentionally dumb: it owns no state. The parent
// (`DocumentTreePanel`) drives `isOpen`, drafts, and validation so
// only one add UI is visible at a time across the whole tree.
export function AddKeyRow({
  parentPath,
  parentDepth,
  isOpen,
  keyDraft,
  valueDraft,
  addError,
  onStart,
  onKeyDraftChange,
  onValueDraftChange,
  onCommit,
  onCancel,
  keyInputRef,
  valueInputRef,
}: {
  parentPath: string;
  parentDepth: number;
  isOpen: boolean;
  keyDraft: string;
  valueDraft: string;
  addError: string | null;
  onStart: () => void;
  onKeyDraftChange: (v: string) => void;
  onValueDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  keyInputRef: React.RefObject<HTMLInputElement | null>;
  valueInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("document");
  const indent = (parentDepth + 1) * 16;
  const pathKey = parentPath || "__root";
  const ariaLabel = t("treePanel.addKeyAriaLabel", {
    target: parentPath === "" ? "root" : parentPath,
  });

  if (!isOpen) {
    return (
      <div
        data-testid={`tree-add-key-row-${pathKey}`}
        className="px-1 py-0.5"
        style={{ paddingLeft: `${indent}px` }}
      >
        <button
          type="button"
          role="button"
          data-testid={`tree-add-key-${pathKey}`}
          aria-label={ariaLabel}
          onClick={onStart}
          className="inline-flex items-center gap-1 rounded border border-dashed border-muted-foreground/40 px-2 py-0 text-3xs text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Plus size={10} aria-hidden />
          <span>{t("treePanel.addKeyButton")}</span>
        </button>
      </div>
    );
  }

  // Open — paired key + value inputs.
  const onKeyKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab" && !e.shiftKey) {
      // Browser default would move focus to the next focusable element;
      // jsdom does not always honour that across testing-library
      // user-event versions, so we manually focus the value input as
      // a deterministic fallback. preventDefault keeps the cursor
      // here when the ref-call is the active mechanism.
      e.preventDefault();
      valueInputRef.current?.focus();
    }
  };
  const onValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      keyInputRef.current?.focus();
    }
  };

  return (
    <div
      data-testid={`tree-add-key-row-${pathKey}`}
      className="flex flex-col gap-0.5 px-1 py-0.5"
      style={{ paddingLeft: `${indent}px` }}
    >
      <div className="flex items-center gap-1">
        <input
          type="text"
          ref={keyInputRef}
          value={keyDraft}
          onChange={(e) => onKeyDraftChange(e.target.value)}
          onKeyDown={onKeyKeyDown}
          placeholder="key"
          aria-label={t("treePanel.addKeyInputAriaLabel", {
            parent: ariaLabel,
          })}
          aria-invalid={addError !== null ? "true" : undefined}
          data-testid={`tree-add-key-input-${pathKey}`}
          className="inline-block w-32 rounded border border-primary bg-background px-1 text-foreground"
        />
        <span className="text-muted-foreground">:</span>
        <input
          type="text"
          ref={valueInputRef}
          value={valueDraft}
          onChange={(e) => onValueDraftChange(e.target.value)}
          onKeyDown={onValueKeyDown}
          placeholder="value"
          aria-label={t("treePanel.addValueInputAriaLabel", {
            parent: ariaLabel,
          })}
          data-testid={`tree-add-value-input-${pathKey}`}
          className="inline-block w-40 rounded border border-primary bg-background px-1 text-foreground"
        />
      </div>
      {addError !== null && (
        <span
          aria-live="polite"
          data-testid={`tree-add-key-error-${pathKey}`}
          className="text-3xs text-red-500"
        >
          {addError}
        </span>
      )}
    </div>
  );
}

// Sprint 344 Slice C (2026-05-15) — `+ item` row for array nodes.
// Closed state: dashed `+ item` button at the array's child indent.
// Open state: a muted, read-only `[N]` index label sitting next to a
// single value input. Enter commits, Esc cancels — there is no key
// input because arrays are indexed automatically (see `nextItemIndex`
// in the panel; the parent passes the resolved next-slot index in).
//
// Like AddKeyRow this component owns no state; the panel drives
// `isOpen`, `valueDraft`, and the commit/cancel callbacks so only one
// inline add UI is ever visible across the whole tree.
export function AddItemRow({
  arrayPath,
  parentDepth,
  isOpen,
  valueDraft,
  nextIndex,
  onStart,
  onValueDraftChange,
  onCommit,
  onCancel,
  valueInputRef,
}: {
  arrayPath: string;
  parentDepth: number;
  isOpen: boolean;
  valueDraft: string;
  nextIndex: number;
  onStart: () => void;
  onValueDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  valueInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslation("document");
  const indent = (parentDepth + 1) * 16;
  const ariaLabel = t("treePanel.addItemAriaLabel", { arrayPath });

  if (!isOpen) {
    return (
      <div
        data-testid={`tree-add-item-row-${arrayPath}`}
        className="px-1 py-0.5"
        style={{ paddingLeft: `${indent}px` }}
      >
        <button
          type="button"
          role="button"
          data-testid={`tree-add-item-${arrayPath}`}
          aria-label={ariaLabel}
          onClick={onStart}
          className="inline-flex items-center gap-1 rounded border border-dashed border-muted-foreground/40 px-2 py-0 text-3xs text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <Plus size={10} aria-hidden />
          <span>{t("treePanel.addItemButton")}</span>
        </button>
      </div>
    );
  }

  const onValueKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onCommit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      data-testid={`tree-add-item-row-${arrayPath}`}
      className="flex items-center gap-1 px-1 py-0.5"
      style={{ paddingLeft: `${indent}px` }}
    >
      {/* Index label — read-only span so users cannot click/type
          inside it. The index is owned entirely by the panel
          (`nextItemIndex`) and advances automatically across
          consecutive adds. `onMouseDown` preventDefault keeps the
          focus on the value input when the user mis-clicks the label
          (jsdom otherwise steals focus to <body>). */}
      <span
        aria-hidden
        data-testid={`tree-add-item-index-${arrayPath}`}
        onMouseDown={(e) => e.preventDefault()}
        className="font-mono text-muted-foreground"
      >
        [{nextIndex}]
      </span>
      <span className="text-muted-foreground">:</span>
      <input
        type="text"
        ref={valueInputRef}
        value={valueDraft}
        onChange={(e) => onValueDraftChange(e.target.value)}
        onKeyDown={onValueKeyDown}
        placeholder="value"
        aria-label={t("treePanel.addItemInputAriaLabel", { parent: ariaLabel })}
        data-testid={`tree-add-item-input-${arrayPath}`}
        className="inline-block w-40 rounded border border-primary bg-background px-1 text-foreground"
      />
    </div>
  );
}

export function PlainLeafInput({
  draft,
  onDraftChange,
  onCommit,
  onCancel,
  testId,
  typeTag,
}: {
  draft: string;
  onDraftChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  testId: string;
  typeTag: string;
}) {
  return (
    <>
      <span className="ml-1 text-muted-foreground">:</span>
      <input
        type="text"
        autoFocus
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        data-testid={testId}
        className="ml-1 inline-block w-56 rounded border border-primary bg-background px-1 align-middle text-foreground"
      />
      <TagBadge>{typeTag}</TagBadge>
    </>
  );
}

export function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-background px-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">
        {value.toLocaleString()}
      </span>
    </div>
  );
}

export function TagBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-1.5 inline-block rounded bg-muted px-1 py-0 align-middle text-4xs tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

// Sprint 344 Slice A — amber NEW pill for ghost rows (paths that exist
// only in `pendingByPath`). Visually distinct from the inline
// "● edited" marker used for edits on existing leaves; same amber tone
// keeps it in the pending family.
export function NewBadge() {
  return (
    <span className="ml-2 inline-block rounded bg-amber-400/20 px-1 py-0 align-middle text-4xs font-semibold uppercase tracking-wider text-amber-500 dark:text-amber-300">
      NEW
    </span>
  );
}
