import { Button } from "@components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import {
  Play,
  Square,
  Loader2,
  Paintbrush,
  Star,
  Save,
  X,
  FlaskConical,
} from "lucide-react";
import FavoritesPanel from "../FavoritesPanel";
import type { QueryTab, QueryMode } from "@stores/tabStore";
import type { QueryFavoritesState } from "./useQueryFavorites";

/**
 * `QueryTab` 의 toolbar 컴포넌트.
 *
 * 책임: Run/Cancel + Format + Mongo Mode toggle (Find/Aggregate) +
 * Save/Favorites buttons + 2 popover (Save 폼 / `<FavoritesPanel>` mount).
 * Save 와 Favorites popover 는 상호 배타 — 한 쪽 열 때 다른 쪽 close.
 *
 * Invariants:
 * - The Save button is disabled iff `tab.sql` is empty. The save form's
 *   own confirm button (inside the popover) gates on `favoriteName`.
 * - The Favorites button is always enabled — even with zero favorites,
 *   the panel must open so the user can add one via drag-and-drop.
 * - Run's `⌘⏎` label is onboarding text; the actual shortcut lives in
 *   the keyboard layer.
 */

export interface QueryTabToolbarProps {
  tab: QueryTab;
  isDocument: boolean;
  onExecute: () => void;
  /**
   * Sprint 248 (ADR 0022 Phase 4) — explicit "Dry Run" handler. Wraps
   * the editor SQL in a transaction that is unconditionally rolled
   * back, so the user can preview destructive results without
   * committing. Mongo paradigm renders the button disabled (the IPC
   * supports rdb only); the keyboard shortcut layer additionally
   * surfaces a toast disclaimer when invoked on document tabs.
   */
  onDryRun: () => void;
  onFormat: () => void;
  onSetQueryMode: (tabId: string, mode: QueryMode) => void;
  favorites: QueryFavoritesState;
}

export default function QueryTabToolbar({
  tab,
  isDocument,
  onExecute,
  onDryRun,
  onFormat,
  onSetQueryMode,
  favorites,
}: QueryTabToolbarProps) {
  const {
    showSaveForm,
    setShowSaveForm,
    favoriteName,
    setFavoriteName,
    showFavorites,
    setShowFavorites,
    favorites: favoritesList,
    handleSaveFavorite,
    handleLoadFavoriteSql,
  } = favorites;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-2 py-1">
      {tab.queryState.status === "running" ? (
        <Button
          variant="ghost"
          size="xs"
          onClick={onExecute}
          aria-label="Cancel query"
        >
          <Square className="text-destructive" />
          <Loader2 className="animate-spin" />
          <span>Cancel</span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          onClick={onExecute}
          disabled={!tab.sql.trim()}
          aria-label="Run query"
        >
          <Play className="text-success" />
          <span>Run</span>
          <span className="text-3xs text-muted-foreground">{"⌘⏎"}</span>
        </Button>
      )}
      {/* Sprint 248 (ADR 0022 Phase 4) — explicit "Dry Run" button.
          BEGIN/ROLLBACK preview without commit. Mongo paradigm is
          unsupported (IPC rejects with `Unsupported`), so the button is
          disabled there. Disabled mirror of Run's gating: empty SQL or
          a query already running both block dispatch. */}
      <Button
        variant="ghost"
        size="xs"
        onClick={onDryRun}
        disabled={
          isDocument || tab.queryState.status === "running" || !tab.sql.trim()
        }
        aria-label="Dry run query"
        title="Dry run (Cmd+Shift+Enter) — BEGIN; ... ROLLBACK"
      >
        <FlaskConical />
        <span>Dry Run</span>
        <span className="text-3xs text-muted-foreground">{"⌘⇧⏎"}</span>
      </Button>
      {!isDocument && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onFormat}
          disabled={!tab.sql.trim()}
          aria-label="Format SQL"
          title="Format SQL (Cmd+I)"
        >
          <Paintbrush />
          <span>Format</span>
        </Button>
      )}
      {isDocument && (
        <ToggleGroup
          type="single"
          value={tab.queryMode}
          onValueChange={(value) => {
            if (value === "find" || value === "aggregate") {
              onSetQueryMode(tab.id, value as QueryMode);
            }
          }}
          aria-label="Mongo query mode"
          className="ml-1"
        >
          <ToggleGroupItem value="find" aria-label="Find mode">
            Find
          </ToggleGroupItem>
          <ToggleGroupItem value="aggregate" aria-label="Aggregate mode">
            Aggregate
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      <div className="ml-auto flex items-center gap-1 relative">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setShowSaveForm(!showSaveForm);
            setShowFavorites(false);
          }}
          disabled={!tab.sql.trim()}
          aria-label="Save to favorites"
          title="Save to favorites"
        >
          <Star />
          <span>Save</span>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setShowFavorites(!showFavorites);
            setShowSaveForm(false);
          }}
          aria-label="Open favorites"
          title="Favorites (Cmd+Shift+F)"
        >
          <Star className="text-primary" />
          <span>
            Favorites
            {favoritesList.length > 0 ? ` (${favoritesList.length})` : ""}
          </span>
        </Button>
        {showSaveForm && (
          <div className="absolute right-0 top-full mt-1 z-50 flex items-center gap-1 rounded border border-border bg-background p-2 shadow-lg">
            <input
              type="text"
              value={favoriteName}
              onChange={(e) => setFavoriteName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveFavorite();
                if (e.key === "Escape") setShowSaveForm(false);
              }}
              placeholder="Favorite name..."
              className="h-6 w-40 rounded border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring"
              autoFocus
            />
            <Button
              size="xs"
              onClick={handleSaveFavorite}
              disabled={!favoriteName.trim()}
              aria-label="Confirm save"
            >
              <Save />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setShowSaveForm(false);
                setFavoriteName("");
              }}
              aria-label="Cancel save"
            >
              <X />
            </Button>
          </div>
        )}
        {showFavorites && (
          <div className="absolute right-0 top-full mt-1 z-50">
            <FavoritesPanel
              connectionId={tab.connectionId}
              onLoadSql={handleLoadFavoriteSql}
              onClose={() => setShowFavorites(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
