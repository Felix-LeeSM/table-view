import { useCallback, useEffect, useState } from "react";
import { resolveActiveDb, useWorkspaceStore } from "@stores/workspaceStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import type { QueryTab } from "@stores/workspaceStore";

/**
 * `QueryTab` 의 favorites state + handler + toggle event 캡슐화.
 *
 * 책임:
 *   - Save 폼 / FavoritesPanel popover 의 열림/닫힘 + 입력 중인 favorite
 *     이름 state (3 useState).
 *   - Save / Load 두 handler.
 *   - `toggle-favorites` window event listener (Cmd+Shift+F) — active
 *     tab 일 때만 panel 토글.
 *
 * Invariants:
 * - The Save and Favorites popovers can't both be open. The Toolbar
 *   closes the other when one opens; this hook only exposes setters.
 * - Save with empty name or empty SQL is a silent no-op.
 * - `toggle-favorites` only fires on the active tab; inactive tabs
 *   require a manual click.
 */

export interface UseQueryFavoritesArgs {
  tab: QueryTab;
}

export interface QueryFavoritesState {
  showSaveForm: boolean;
  setShowSaveForm: React.Dispatch<React.SetStateAction<boolean>>;
  favoriteName: string;
  setFavoriteName: React.Dispatch<React.SetStateAction<string>>;
  showFavorites: boolean;
  setShowFavorites: React.Dispatch<React.SetStateAction<boolean>>;
  favorites: ReturnType<typeof useFavoritesStore.getState>["favorites"];
  handleSaveFavorite: () => void;
  handleLoadFavoriteSql: (sql: string) => void;
}

export function useQueryFavorites({
  tab,
}: UseQueryFavoritesArgs): QueryFavoritesState {
  const updateQuerySqlAction = useWorkspaceStore((s) => s.updateQuerySql);
  const addFavorite = useFavoritesStore((s) => s.addFavorite);
  const favorites = useFavoritesStore((s) => s.favorites);

  const [showSaveForm, setShowSaveForm] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [showFavorites, setShowFavorites] = useState(false);

  const handleSaveFavorite = useCallback(() => {
    const name = favoriteName.trim();
    const sql = tab.sql.trim();
    if (!name || !sql) return;
    addFavorite(name, sql, tab.connectionId);
    setFavoriteName("");
    setShowSaveForm(false);
  }, [favoriteName, tab.sql, tab.connectionId, addFavorite]);

  const handleLoadFavoriteSql = useCallback(
    (sql: string) => {
      const db = tab.database ?? resolveActiveDb(tab.connectionId);
      updateQuerySqlAction(tab.connectionId, db, tab.id, sql);
    },
    [tab.id, tab.connectionId, tab.database, updateQuerySqlAction],
  );

  // Toggle favorites panel event listener (Cmd+Shift+F)
  useEffect(() => {
    const handler = () => {
      const wsState = useWorkspaceStore.getState();
      const isActive = Object.values(wsState.workspaces).some((byDb) =>
        Object.values(byDb).some((ws) => ws.activeTabId === tab.id),
      );
      if (!isActive) return;
      setShowFavorites((v) => !v);
      setShowSaveForm(false);
    };
    window.addEventListener("toggle-favorites", handler);
    return () => window.removeEventListener("toggle-favorites", handler);
  }, [tab.id]);

  return {
    showSaveForm,
    setShowSaveForm,
    favoriteName,
    setFavoriteName,
    showFavorites,
    setShowFavorites,
    favorites,
    handleSaveFavorite,
    handleLoadFavoriteSql,
  };
}
