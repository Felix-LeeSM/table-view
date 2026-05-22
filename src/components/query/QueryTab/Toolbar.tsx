import { Button } from "@components/ui/button";
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
import TabDbChip from "./TabDbChip";
import type { QueryTab } from "@stores/workspaceStore";
import type { QueryFavoritesState } from "./useQueryFavorites";
import {
  classifyMongoStatement,
  statementAllowsMissingDatabase,
} from "@/lib/mongo/runCommandParser";

/**
 * `QueryTab` 의 toolbar 컴포넌트.
 *
 * 책임: Run/Cancel + Format + Save/Favorites buttons + 2 popover
 * (Save 폼 / `<FavoritesPanel>` mount). Save 와 Favorites popover 는
 * 상호 배타 — 한 쪽 열 때 다른 쪽 close.
 *
 * Sprint 309 — Find/Aggregate `ToggleGroup` removed. The mongosh parser
 * (A1) infers the method from the editor text, so the toggle no longer
 * carries information. `onSetQueryMode` is gone from this surface; the
 * store action stays exported for `loadQueryIntoTab` backward-compat.
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
  canCancelQuery?: boolean;
  onExecute: () => void;
  /**
   * Wraps the editor SQL in a transaction that is unconditionally
   * rolled back, so the user can preview destructive results without
   * committing. Rendered only for the RDB paradigm — the dry-run IPC
   * has no Mongo equivalent.
   */
  onDryRun: () => void;
  onFormat: () => void;
  favorites: QueryFavoritesState;
}

export default function QueryTabToolbar({
  tab,
  isDocument,
  canCancelQuery = true,
  onExecute,
  onDryRun,
  onFormat,
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

  // Sprint 381 (2026-05-17) — Mongo db-contract α. The Run button used
  // to be disabled whenever Mongo's `tab.database` was empty, which
  // blocked admin commands (`db.runCommand({ping: 1})`) that don't need
  // a bound database. The new gate splits two axes:
  //   - statement is *non-empty* (`tab.sql.trim()` — unchanged check)
  //   - statement is *runnable* — for document paradigm, classify into
  //     admin-command (DB-less OK) vs collection-command (DB required)
  //     vs unknown (treat like collection: require DB to avoid silently
  //     allowing typos through the AST parser).
  // The actual dispatch gate stays in `useQueryExecution` — Toolbar only
  // controls the disabled state + tooltip.
  const isDocumentTab = isDocument;
  const mongoStatementKind = isDocumentTab
    ? classifyMongoStatement(tab.sql)
    : "unknown";
  const documentNeedsDb =
    isDocumentTab &&
    !tab.database &&
    !statementAllowsMissingDatabase(mongoStatementKind);
  const runDisabled = !tab.sql.trim() || documentNeedsDb;
  const runDisabledTooltip = documentNeedsDb
    ? "Pick a database from the toolbar chip to run collection commands. Admin commands (`db.runCommand({...})`) work without one."
    : undefined;

  return (
    <div className="flex items-center gap-2 border-b border-border bg-secondary px-2 py-1">
      {/* 2026-05-15 — Sprint 329 의 display-only chip 을 interactive
          selector 로 교체. tab-local 시맨틱은 유지 (`tab.database` 만
          갱신; connection.activeDb 는 그대로). */}
      {isDocument && (
        <TabDbChip
          tabId={tab.id}
          database={tab.database ?? ""}
          connectionId={tab.connectionId}
        />
      )}
      {tab.queryState.status === "running" && canCancelQuery ? (
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
      ) : tab.queryState.status === "running" ? (
        <Button
          variant="ghost"
          size="xs"
          disabled
          aria-label="Query running"
          title="Query cancellation is not supported for this database."
        >
          <Loader2 className="animate-spin" />
          <span>Running</span>
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="xs"
          onClick={onExecute}
          disabled={runDisabled}
          aria-label="Run query"
          title={runDisabledTooltip}
        >
          <Play className="text-success" />
          <span>Run</span>
          <span className="text-3xs text-muted-foreground">{"⌘⏎"}</span>
        </Button>
      )}
      {!isDocument && (
        <Button
          variant="ghost"
          size="xs"
          onClick={onDryRun}
          disabled={tab.queryState.status === "running" || !tab.sql.trim()}
          aria-label="Dry run query"
          title="Dry run (Cmd+Shift+Enter) — BEGIN; ... ROLLBACK"
        >
          <FlaskConical />
          <span>Dry Run</span>
          <span className="text-3xs text-muted-foreground">{"⌘⇧⏎"}</span>
        </Button>
      )}
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
