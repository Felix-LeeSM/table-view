import { useCallback, useEffect, useState } from "react";
import { useTabStore } from "@stores/tabStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import type { QueryTab } from "@stores/tabStore";

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
 * Sprint 201 에서 entry 로부터 추출. 동작 0 변경.
 *
 * 외부 invariant:
 * - Save 와 Favorites popover 는 동시에 열릴 수 없음 — Toolbar 가 한
 *   쪽 열 때 다른 쪽 close 하는 책임. 본 hook 은 state setter 만 노출.
 * - Save handler 는 빈 이름 / 빈 SQL 을 silent no-op 으로 반환.
 * - `toggle-favorites` listener 는 active tab 만 처리 — 비활성 tab 의
 *   favorites panel 은 사용자가 클릭으로 직접 열어야 함.
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
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
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
      updateQuerySql(tab.id, sql);
    },
    [tab.id, updateQuerySql],
  );

  // Toggle favorites panel event listener (Cmd+Shift+F)
  useEffect(() => {
    const handler = () => {
      const { activeTabId } = useTabStore.getState();
      if (activeTabId !== tab.id) return;
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
