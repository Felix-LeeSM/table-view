import { useEffect, useMemo, useState } from "react";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import { isEditableTarget } from "@/lib/keyboard/isEditableTarget";

// ---------------------------------------------------------------------------
// Sprint-103 — Global keyboard shortcut cheatsheet.
//
// Discoverability surface for every global shortcut wired up in `App.tsx`.
// Opens on `?` (Shift+/) or Cmd+/ / Ctrl+/. The component owns its own
// `open` state and registers a global `keydown` listener so callers
// (`App.tsx`) only need to mount `<ShortcutCheatsheet />` once.
//
// Key handling rules (mirrors the contract):
//   - `?`        Shift+/ → open. Suppressed when focus is inside an
//                INPUT/TEXTAREA/SELECT/contenteditable element so the user
//                can still type "?" into a SQL editor or a search box
//                without the cheatsheet hijacking the keystroke.
//   - Cmd+/      / Ctrl+/ → open unconditionally. The modifier combination
//                cannot be produced by typing characters into a text field,
//                so guarding it would only hide the affordance.
//   - Esc / outside-click → handled by the underlying `Dialog` primitive
//                (`PreviewDialog` does not need a custom close handler
//                beyond `onCancel`).
//
// The cheatsheet is read-only: we use `PreviewDialog` *without* `onConfirm`
// so the footer disappears and the absolute X button is the only confirm
// affordance, matching `CellDetailDialog`'s pattern.
//
// Key labels (e.g. `Cmd+W`) are intentionally not branched per platform
// for now — see Sprint Contract "Out of Scope".
// ---------------------------------------------------------------------------

interface ShortcutItem {
  /** Human-readable description of the action. */
  label: string;
  /** Display-formatted key combination(s), e.g. ["Cmd+R", "F5"]. */
  keys: string[];
}

interface ShortcutGroup {
  label: string;
  items: ShortcutItem[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "Tabs",
    items: [
      { label: "Close tab", keys: ["Cmd+W"] },
      { label: "New query tab", keys: ["Cmd+T"] },
      { label: "Reopen last closed tab", keys: ["Cmd+Shift+T"] },
    ],
  },
  {
    label: "Editing",
    items: [
      { label: "Commit changes", keys: ["Cmd+S"] },
      { label: "Format SQL", keys: ["Cmd+I"] },
      { label: "Uglify SQL", keys: ["Cmd+Shift+I"] },
    ],
  },
  {
    label: "Navigation",
    items: [
      { label: "Quick open", keys: ["Cmd+P"] },
      { label: "Refresh", keys: ["Cmd+R", "F5"] },
      { label: "Cancel running query", keys: ["Cmd+."] },
    ],
  },
  {
    label: "Panels",
    items: [
      { label: "Settings", keys: ["Cmd+,"] },
      { label: "Toggle favorites", keys: ["Cmd+Shift+F"] },
      { label: "Toggle global query log", keys: ["Cmd+Shift+C"] },
    ],
  },
  {
    label: "Misc",
    items: [
      { label: "New connection", keys: ["Cmd+N"] },
      { label: "Show this cheatsheet", keys: ["?", "Cmd+/"] },
    ],
  },
];

function matchesShortcut(item: ShortcutItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.label} ${item.keys.join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

export default function ShortcutCheatsheet() {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+/ or Ctrl+/ — modifier combo, no editable-target guard needed.
      if ((event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        setSearch("");
        setOpen(true);
        return;
      }

      // `?` (Shift+/). Skip when focus is in a text-entry element so the
      // user can still type literal `?` characters.
      if (event.key === "?") {
        if (isEditableTarget(event.target)) return;
        event.preventDefault();
        setSearch("");
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const normalizedQuery = search.trim().toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!normalizedQuery) return SHORTCUT_GROUPS;
    return SHORTCUT_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.filter((item) =>
        matchesShortcut(item, normalizedQuery),
      ),
    })).filter((group) => group.items.length > 0);
  }, [normalizedQuery]);

  const matchCount = filteredGroups.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );

  if (!open) return null;

  return (
    <PreviewDialog
      title="Keyboard shortcuts"
      description="Press ? or Cmd+/ to toggle this panel."
      className="sm:max-w-2xl"
      onCancel={() => setOpen(false)}
    >
      <div className="flex flex-col gap-4">
        <input
          type="text"
          autoFocus
          aria-label="Search shortcuts"
          placeholder="Search shortcuts..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring dark:bg-background"
        />

        {matchCount === 0 ? (
          <div
            role="status"
            className="rounded border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground"
          >
            No shortcuts match
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto pr-1">
            {filteredGroups.map((group) => (
              <section
                key={group.label}
                className="flex flex-col gap-2"
                aria-labelledby={`shortcut-group-${group.label}`}
              >
                <h3
                  id={`shortcut-group-${group.label}`}
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {group.label}
                </h3>
                <dl className="flex flex-col divide-y divide-border rounded border border-border bg-muted/20 dark:bg-muted/10">
                  {group.items.map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between gap-3 px-3 py-2"
                    >
                      <dt className="text-sm text-foreground">{item.label}</dt>
                      <dd className="flex shrink-0 items-center gap-1">
                        {item.keys.map((key, idx) => (
                          <span
                            key={`${item.label}-${key}-${idx}`}
                            className="rounded border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground shadow-sm dark:bg-muted/30"
                          >
                            {key}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      </div>
    </PreviewDialog>
  );
}
