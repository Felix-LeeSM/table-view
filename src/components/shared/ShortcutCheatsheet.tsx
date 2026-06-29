import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import { isEditableTarget } from "@/lib/keyboard/isEditableTarget";

// ---------------------------------------------------------------------------
// Global keyboard shortcut cheatsheet — discoverability surface for every
// global shortcut wired up in `App.tsx`. Opens on `?` (Shift+/) or
// Cmd+/ / Ctrl+/. Owns its own `open` state and registers a global
// `keydown` listener so `App.tsx` only mounts `<ShortcutCheatsheet />` once.
//
// Key handling:
//   - `?` (Shift+/) → open. Suppressed when focus is inside an
//     INPUT/TEXTAREA/SELECT/contenteditable element so the user can still
//     type "?" into a SQL editor or search box.
//   - Cmd+/ / Ctrl+/ → open unconditionally. Modifier combos cannot be
//     produced by typing characters into a text field.
//   - Esc / outside-click → handled by the underlying `Dialog` primitive.
//
// Read-only: `PreviewDialog` *without* `onConfirm` so the footer
// disappears and the absolute X button is the only confirm affordance.
// Key labels are not branched per platform.
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

function matchesShortcut(item: ShortcutItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.label} ${item.keys.join(" ")}`.toLowerCase();
  return haystack.includes(query);
}

export default function ShortcutCheatsheet() {
  const { t } = useTranslation("shared");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // ponytail: SHORTCUT_GROUPS built inside component so labels stay reactive to locale changes.
  const SHORTCUT_GROUPS: ShortcutGroup[] = useMemo(
    () => [
      {
        label: t("shortcuts.groupTabs"),
        items: [
          { label: t("shortcuts.closeTab"), keys: ["Cmd+W"] },
          { label: t("shortcuts.newQueryTab"), keys: ["Cmd+T"] },
          { label: t("shortcuts.reopenLastTab"), keys: ["Cmd+Shift+T"] },
          // Cmd+1..9 jumps to the N-th workspace tab.
          { label: t("shortcuts.switchToTab"), keys: ["Cmd+1", "…", "Cmd+9"] },
        ],
      },
      {
        label: t("shortcuts.groupEditing"),
        items: [
          { label: t("shortcuts.commitChanges"), keys: ["Cmd+S"] },
          { label: t("shortcuts.formatSql"), keys: ["Cmd+I"] },
          { label: t("shortcuts.uglifySql"), keys: ["Cmd+Shift+I"] },
        ],
      },
      {
        label: t("shortcuts.groupNavigation"),
        items: [
          { label: t("shortcuts.quickOpen"), keys: ["Cmd+P"] },
          { label: t("shortcuts.refresh"), keys: ["Cmd+R", "F5"] },
          { label: t("shortcuts.cancelQuery"), keys: ["Cmd+."] },
          // Connection swap is Home → double-click only — no Cmd+K shortcut.
        ],
      },
      {
        label: t("shortcuts.groupPanels"),
        items: [
          // Cmd+, toggles the Home / Workspace screens.
          { label: t("shortcuts.toggleHomeWorkspace"), keys: ["Cmd+,"] },
          { label: t("shortcuts.toggleFavorites"), keys: ["Cmd+Shift+F"] },
          { label: t("shortcuts.toggleQueryLog"), keys: ["Cmd+Shift+C"] },
        ],
      },
      {
        label: t("shortcuts.groupMisc"),
        items: [
          { label: t("shortcuts.newQueryTab"), keys: ["Cmd+N", "Cmd+T"] },
          { label: t("shortcuts.showCheatsheet"), keys: ["?", "Cmd+/"] },
        ],
      },
    ],
    [t],
  );

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
  }, [normalizedQuery, SHORTCUT_GROUPS]);

  const matchCount = filteredGroups.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );

  if (!open) return null;

  return (
    <PreviewDialog
      title={t("shortcuts.title")}
      description={t("shortcuts.description")}
      className="sm:max-w-2xl"
      onCancel={() => setOpen(false)}
    >
      <div className="flex flex-col gap-4">
        <input
          type="text"
          autoFocus
          aria-label={t("shortcuts.searchLabel")}
          placeholder={t("shortcuts.searchPlaceholder")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring dark:bg-background"
        />

        {matchCount === 0 ? (
          <div
            role="status"
            className="rounded border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground"
          >
            {t("shortcuts.noMatch")}
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
