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
import type { EditorView } from "@codemirror/view";
import FavoritesPanel from "../FavoritesPanel";
import InsertSnippetMenu from "./InsertSnippetMenu";
import TabDbChip from "./TabDbChip";
import type { QueryTab } from "@stores/workspaceStore";
import type { QueryFavoritesState } from "./useQueryFavorites";

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
  favorites: QueryFavoritesState;
  /**
   * Sprint 310 (Phase 28 Slice A4) — CodeMirror EditorView ref drilled
   * from `useQueryEvents` so the `+ Insert ▾` popover can dispatch
   * snippet insertion against the live editor. Decision D-09: prop
   * drilling is preferred over context / store because the ref already
   * lives in `useQueryEvents` and ergonomics + minimum diff favour a
   * single explicit prop on the toolbar interface.
   */
  editorRef: React.RefObject<EditorView | null>;
}

export default function QueryTabToolbar({
  tab,
  isDocument,
  onExecute,
  onDryRun,
  onFormat,
  favorites,
  editorRef,
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
      {/* Sprint 309 — Mongo Find/Aggregate `ToggleGroup` removed. The
          mongosh parser (Sprint 307 A1) infers the method from the editor
          text; the toggle no longer carried information that the editor
          itself doesn't already express. A5 (sprint-311) replaces the
          legacy aggregate-flag dispatch branch with parser-driven
          routing. */}
      {/* Sprint 310 (Phase 28 Slice A4) — `+ Insert ▾` snippet menu.
          Document-paradigm only (the popover surfaces the 13 mongosh
          methods + filter operators + aggregate stages; RDB has its own
          SQL formatter path and intentionally does NOT mount this
          button). The snippet engine drives CodeMirror's native
          Tab/Shift+Tab/Esc placeholder navigation. */}
      {isDocument && <InsertSnippetMenu editorRef={editorRef} />}
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
