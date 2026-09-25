import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@components/ui/alert-dialog";
import { Button } from "@components/ui/button";
import { DB_TYPE_META } from "@lib/db-meta";
import { useRecentConnections } from "@lib/runtime/connection/useRecentConnections";
import { Clock, Database, Eraser, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { activateConnection } from "./ConnectionList";

/**
 * Format a `Date.now()` epoch ms timestamp as a short relative
 * time label (e.g. "just now", "5m ago", "3h ago", "2d ago").
 */
export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface RecentConnectionsProps {
  onActivate?: (id: string) => void;
}

/**
 * Recent Connections UI for the launcher.
 * Per-entry X removal.
 * No internal chevron header: it nested with the external label header, and
 * users read the result as "yet another tab" — removing it prevents that
 * regression.
 * #2440 — the mount point moved from the HomePage footer to `ConnectionBrowser`'s
 * `Recent` rail view. The component itself is unchanged.
 *
 * #2433 — the row is the connect target, so remove is a hover/focus-only
 * affordance and "clear all" sits at the foot of the list rather than in the
 * launcher action bar.
 *
 * Renders the user's most recently used connections (from `mruStore`) resolved
 * against the full connection list from `connectionStore`. The cap is
 * `MAX_ENTRIES` in `src/stores/mruStore.ts`; the `slice` below is the second,
 * independent copy of that bound and is what holds when a caller seeds the
 * store past the cap.
 *
 * Activation: double-click or Enter activates the row — the same
 * `activateConnection` wrap the All/group views' `ConnectionList` rows use,
 * which opens/focuses the per-conn workspace window and then hands the id to
 * `onActivate` for the store-side update (#2457: the Recent route used to skip
 * the window-open half).
 */
export default function RecentConnections({
  onActivate,
}: RecentConnectionsProps) {
  const { t } = useTranslation("featuresConnection");
  const { resolved, removeRecent, clearRecent } = useRecentConnections();
  const [confirmClear, setConfirmClear] = useState(false);

  if (resolved.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-muted-foreground italic">
        {t("recent.empty")}
      </div>
    );
  }

  return (
    <>
      <div
        className="space-y-0.5"
        role="list"
        aria-label={t("recent.ariaList")}
      >
        {resolved.slice(0, 5).map(({ connectionId, lastUsed, conn }) => (
          <div
            key={connectionId}
            role="listitem"
            className="group flex items-center gap-2 px-3 py-1 text-sm cursor-pointer hover:bg-muted rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("recent.ariaItem", {
              name: conn.name,
              time: relativeTime(lastUsed),
            })}
            tabIndex={0}
            onClick={() => {}} // single click: nothing special
            onDoubleClick={() => activateConnection(connectionId, onActivate)}
            onKeyDown={(e) => {
              if (e.key === "Enter")
                activateConnection(connectionId, onActivate);
            }}
          >
            <Database size={12} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-foreground">{conn.name}</span>
            <span
              className="ml-auto shrink-0 rounded px-1 py-0.5 text-4xs font-semibold leading-none"
              style={{
                backgroundColor: `${DB_TYPE_META[conn.dbType].color}20`,
                color: DB_TYPE_META[conn.dbType].color,
              }}
            >
              {DB_TYPE_META[conn.dbType].short}
            </span>
            {/* Swap slot: the timestamp normally, the X in the same slot on
                hover. A grid stack makes both elements occupy the same cell,
                so the slot width is anchored to the timestamp text and the X
                appearing causes no visual jump. The time stays available in
                the row's aria-label, so nothing depends on hover.
                #2433 — both slots share `group-focus-within`. Toggling only
                the button on `focus-visible` would leave the timestamp
                visible for keyboard users and stack the two elements in the
                same cell. The row carries `tabIndex={0}`, so remove appears
                as soon as Tab reaches the row, and one more Tab moves focus
                to the button itself. */}
            <div className="grid shrink-0 items-center justify-items-end">
              <div className="col-start-1 row-start-1 flex items-center gap-1 text-3xs text-muted-foreground whitespace-nowrap transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                <Clock size={10} className="shrink-0" />
                <span>{relativeTime(lastUsed)}</span>
              </div>
              {/* #2433 — grow the target from 16px (p-0.5 + a 12px icon) to 24px.
                  The row itself is the connect target, so remove shows only on
                  hover/focus, and the slot width is held by the timestamp text
                  beside it, so the larger button still appears without a
                  visual jump. */}
              <button
                type="button"
                aria-label={t("recent.removeAria", { name: conn.name })}
                className="col-start-1 row-start-1 flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecent(connectionId);
                }}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* #2433 — "Clear all" lives at the foot of the list. It used to be an
          Eraser icon in the launcher action bar, standing beside add-connection
          and add-group, so a destructive action aimed at the list was hit
          before the list itself. When the list is empty the early return
          above never reaches this spot, so there is no button with nothing
          to clear. Kept outside `role="list"` — placing it inside would mix a
          non-listitem child into the list's accessibility tree. */}
      <div className="mt-1 border-t border-border pt-1">
        <button
          type="button"
          data-testid="recent-clear-all"
          className="flex w-full items-center gap-1.5 rounded px-3 py-1 text-left text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setConfirmClear(true)}
        >
          <Eraser size={12} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{t("recent.clearAll")}</span>
        </button>
      </div>

      {/* #2433 — `clear_mru` truncates the SQLite `mru` table with no undo
          path. It also now sits directly beneath each row's remove button, so
          a hand aiming at one entry can easily wipe all of them. The
          destructive confirm convention
          (`memory/engineering/conventions/frontend/memory.md:64-65`) offers
          `ConfirmDestructiveDialog`, which demands `sqlPreview`/`statements`/
          `paradigm` and fires `execute_query_dry_run` as a `DryRunPreview` —
          SQL-only, so it does not fit here. So this uses the convention's
          other accepted shape, the AlertDialog preset
          (`role="alertdialog"`) — exactly what `ConnectionItem` deletion and
          `ConnectionGroup` deletion in the same feature use. No 150ms arm:
          the convention (`:65-66`) requires the arm only for
          `ConfirmDestructiveDialog` and the RDB `SqlPreviewDialog`, so this
          dialog is out of scope. */}
      <AlertDialog
        open={confirmClear}
        onOpenChange={(open) => !open && setConfirmClear(false)}
      >
        <AlertDialogContent
          className="w-80 bg-secondary p-4"
          tone="destructive"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm font-semibold text-foreground">
              {t("recent.clearTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription className="mt-2 text-sm text-secondary-foreground">
              {t("recent.clearDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4 flex justify-end gap-2">
            <AlertDialogCancel>{t("recent.clearCancel")}</AlertDialogCancel>
            <Button
              variant="destructive"
              size="sm"
              data-testid="recent-clear-confirm"
              onClick={() => {
                clearRecent();
                setConfirmClear(false);
              }}
            >
              {t("recent.clearConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
