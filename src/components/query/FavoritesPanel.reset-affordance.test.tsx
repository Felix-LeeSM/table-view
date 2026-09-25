/**
 * Q21 affordance #9 — audit only.
 *
 * Reason: the per-entry remove in the Favorites panel is already the Q21
 * reset affordance, as implemented by the `removeFavorite` button in
 * `FavoritesPanel.tsx`. This file adds no new UI; it is a regression guard —
 * if a later change removes that button by mistake, this test fails.
 * (Q21 audit item #9.)
 *
 * Lego: click remove → one `removeFavorite(id)` zustand action → the entry
 * disappears from the `favorites` array.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(() =>
    Promise.resolve(),
  ),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { useFavoritesStore } from "@stores/favoritesStore";
import FavoritesPanel from "./FavoritesPanel";

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
