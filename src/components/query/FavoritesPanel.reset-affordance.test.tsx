/**
 * 작성 2026-05-17 (Phase 6 sprint-376 Q21 affordance #9 — audit only).
 *
 * 사유: Favorites panel 의 entry-별 remove 는 기존 구현 (FavoritesPanel.tsx
 * line 122-134) 이 그대로 Q21 의 reset affordance. 본 sprint 는 신규
 * UI 추가가 아니라 회귀 가드 — 다음 sprint 가 remove 버튼을 실수로
 * 제거하면 본 test 가 fail. (Q21 audit 항목 #9.)
 *
 * Lego: remove 버튼 클릭 → `removeFavorite(id)` zustand action 1회 →
 * `favorites` array 에서 해당 entry 가 사라짐.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import FavoritesPanel from "./FavoritesPanel";
import { useFavoritesStore } from "@stores/favoritesStore";

describe("FavoritesPanel reset affordance (Q21 #9 — audit)", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    useFavoritesStore.setState({
      favorites: [
        {
          id: "f-1",
          name: "Top users",
          sql: "SELECT * FROM users LIMIT 10",
          connectionId: "c-1",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "f-2",
          name: "Global query",
          sql: "SELECT 1",
          connectionId: null,
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });
  });

  it("entry remove 버튼 클릭 → 해당 favorite 가 store 에서 사라짐 + UI 즉시 갱신", () => {
    render(
      <FavoritesPanel
        connectionId="c-1"
        onLoadSql={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // Pre: both entries visible.
    expect(screen.getByText(/top users/i)).toBeInTheDocument();
    expect(screen.getByText(/global query/i)).toBeInTheDocument();

    const remove = screen.getByRole("button", {
      name: /delete favorite: top users/i,
    });
    fireEvent.click(remove);

    // Post: f-1 removed.
    const ids = useFavoritesStore.getState().favorites.map((f) => f.id);
    expect(ids).toEqual(["f-2"]);
    expect(screen.queryByText(/top users/i)).toBeNull();
    expect(screen.getByText(/global query/i)).toBeInTheDocument();
  });
});
