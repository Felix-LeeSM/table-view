// Sprint 310 (2026-05-14) — Phase 28 Slice A4: `+ Insert ▾` popover menu.
//
// Renders the 4 mongosh snippet sections (Query methods / Mutation methods
// / Operators / Stages) as a popover anchored to a toolbar button. Entry
// activation drives `insertMongoshSnippet` (Sprint 310 engine) against
// the CodeMirror EditorView the parent (`QueryTabToolbar`) drills in.
//
// Keyboard contract (AC-06):
// - Arrow Down / Arrow Up: move focus within the active section.
// - Tab / Shift+Tab: move across sections (delegated to browser default
//   tab order — every entry is a real `<button>`).
// - Enter: activate the focused entry.
// - Escape: close the popover (Radix Popover handles this natively).
//
// On activation: snippet inserted, popover closed, editor refocused
// (AC-07).

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";
import type { EditorView } from "@codemirror/view";
import { Button } from "@components/ui/button";
import { cn } from "@/lib/utils";
import {
  ALL_MONGOSH_SNIPPETS,
  type MongoshSnippet,
} from "@/lib/mongo/mongoshSnippets";
import { insertMongoshSnippet } from "@/lib/mongo/snippetEngine";

export interface InsertSnippetMenuProps {
  /**
   * Ref to the CodeMirror EditorView mounted by `MongoQueryEditor`.
   * Drilled by `QueryTab` → `QueryTabToolbar` → here (decision D-09).
   * Best-effort: if `current` is null at activation time, the menu
   * closes silently — we don't want to surface "editor not ready" toasts
   * on a transient ref. The popover is only mountable when the document
   * paradigm is active, so a null ref is genuinely exceptional.
   */
  editorRef: React.RefObject<EditorView | null>;
}

export default function InsertSnippetMenu({
  editorRef,
}: InsertSnippetMenuProps) {
  const [open, setOpen] = React.useState(false);

  const handleSelect = React.useCallback(
    (snippet: MongoshSnippet) => {
      const view = editorRef.current;
      setOpen(false);
      if (!view) return;
      insertMongoshSnippet(view, snippet.insertText);
      view.focus();
    },
    [editorRef],
  );

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="xs"
          aria-label="Insert mongosh snippet"
          title="Insert mongosh snippet"
        >
          <span>+ Insert</span>
          <ChevronDown />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={4}
          className={cn(
            "z-50 w-80 max-h-[60vh] overflow-y-auto rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-md outline-none",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          {ALL_MONGOSH_SNIPPETS.map((section) => (
            <SnippetSection
              key={section.label}
              label={section.label}
              entries={section.entries}
              onSelect={handleSelect}
            />
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

interface SnippetSectionProps {
  label: string;
  entries: readonly MongoshSnippet[];
  onSelect: (snippet: MongoshSnippet) => void;
}

function SnippetSection({ label, entries, onSelect }: SnippetSectionProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const focusByOffset = React.useCallback(
    (target: HTMLElement, offset: 1 | -1) => {
      const container = containerRef.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
      );
      const idx = items.indexOf(target as HTMLButtonElement);
      if (idx < 0) return;
      const nextIdx = idx + offset;
      if (nextIdx < 0 || nextIdx >= items.length) return;
      const next = items[nextIdx];
      if (next) next.focus();
    },
    [],
  );

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={label}
      className="mb-2 last:mb-0"
    >
      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-col">
        {entries.map((entry) => (
          <button
            key={entry.label}
            type="button"
            role="menuitem"
            aria-label={entry.label}
            // Description is decorative — the accessible name is the
            // snippet label only, so RTL `getByRole("menuitem", { name })`
            // queries map cleanly to the data model.
            className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            onClick={() => onSelect(entry)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                focusByOffset(e.currentTarget, 1);
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                focusByOffset(e.currentTarget, -1);
              } else if (e.key === "Enter") {
                // Native button handles Enter, but Radix Popover's auto
                // focus-trap may intercept; assert explicitly so RTL
                // keyDown(Enter) drives `onSelect` deterministically.
                e.preventDefault();
                onSelect(entry);
              }
            }}
          >
            <span className="font-mono">{entry.label}</span>
            {entry.description ? (
              <span
                aria-hidden="true"
                className="truncate text-3xs text-muted-foreground"
              >
                {entry.description}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
