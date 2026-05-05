import { Button } from "@components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@components/ui/toggle-group";
import { Play, Square, Loader2, Paintbrush, Star, Save, X } from "lucide-react";
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
 * Sprint 201 에서 entry 의 toolbar JSX 영역에서 추출. DOM byte-for-byte
 * 동등 — Run 버튼 disabled 조건 (`!tab.sql.trim()`), Cancel 버튼
 * Square+Loader2 동시 노출, Format 버튼 document paradigm 에서 숨김,
 * Mongo Mode toggle 의 ToggleGroup value/onValueChange 동작 모두 동결.
 *
 * 외부 invariant:
 * - `<Save 버튼 disabled>` 는 SQL 이 비어있을 때만 disabled. favoriteName
 *   비어있으면 Save 폼의 confirm 버튼이 disabled (이 폼은 popover 안).
 * - `Favorites` 버튼은 항상 enabled — favorites 가 0개여도 panel 을 열 수
 *   있어야 (drag-and-drop 으로 처음 추가 가능).
 * - Run 버튼의 단축키 라벨 `⌘⏎` 은 사용자 onboarding 용 — 실제 단축키
 *   handler 는 keyboard layer 별도.
 */

export interface QueryTabToolbarProps {
  tab: QueryTab;
  isDocument: boolean;
  onExecute: () => void;
  onFormat: () => void;
  onSetQueryMode: (tabId: string, mode: QueryMode) => void;
  favorites: QueryFavoritesState;
}

export default function QueryTabToolbar({
  tab,
  isDocument,
  onExecute,
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
