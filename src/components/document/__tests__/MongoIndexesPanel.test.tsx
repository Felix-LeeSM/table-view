// Sprint 350 (2026-05-15) — Tracer: MongoIndexesPanel read-only.
//
// 작성 이유: 본 sprint 가 Mongo collection tab 의 Structure pane 에 read-only
// indexes 패널을 추가한다. `list_mongo_indexes` IPC mock 으로 (a) mount 시
// 정확히 한 번 호출, (b) row 매핑 (primary chip / fields / type / unique),
// (c) 빈 리스트 empty state, (d) IPC 실패 시 role="alert" + 패널 unmount
// 안 됨, (e) loading 시 aria-busy 및 useDelayedFlag(1000) 게이트, (f)
// database/collection 가 빈 문자열인 edge case 의 no-fetch 를 모두 가드.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { MongoIndexesPanel } from "../MongoIndexesPanel";

const listMongoIndexesMock = vi.fn();

vi.mock("@/lib/tauri", () => ({
  listMongoIndexes: (...args: unknown[]) => listMongoIndexesMock(...args),
}));

describe("MongoIndexesPanel (Sprint 350 — tracer RO list)", () => {
  beforeEach(() => {
    listMongoIndexesMock.mockReset();
  });

  it("renders one row per IndexInfo after a successful fetch and fires the IPC exactly once", async () => {
    listMongoIndexesMock.mockResolvedValueOnce([
      {
        name: "_id_",
        columns: ["_id"],
        index_type: "btree",
        is_unique: true,
        is_primary: true,
      },
      {
        name: "email_1",
        columns: ["email"],
        index_type: "btree",
        is_unique: true,
        is_primary: false,
      },
      {
        name: "tags_text",
        columns: ["tags"],
        index_type: "text",
        is_unique: false,
        is_primary: false,
      },
    ]);

    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    await waitFor(() => {
      expect(listMongoIndexesMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
      );
    });

    expect(listMongoIndexesMock).toHaveBeenCalledTimes(1);
    const list = await screen.findByTestId("mongo-indexes-list");
    expect(list).toBeInTheDocument();
    expect(screen.getByText("_id_")).toBeInTheDocument();
    expect(screen.getByText(/primary/i)).toBeInTheDocument();
    expect(screen.getByText("email_1")).toBeInTheDocument();
    expect(screen.getByText("tags_text")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
  });

  it("paints the empty-state copy when the IPC returns no indexes", async () => {
    listMongoIndexesMock.mockResolvedValueOnce([]);

    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="empty_coll"
      />,
    );

    const empty = await screen.findByTestId("mongo-indexes-empty");
    expect(empty).toHaveTextContent(/no indexes/i);
    expect(screen.queryByTestId("mongo-indexes-list")).toBeNull();
  });

  it("surfaces IPC failures via role=alert and keeps the panel mounted", async () => {
    listMongoIndexesMock.mockRejectedValueOnce(new Error("permission denied"));

    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/permission denied/i);
    // Panel root must survive the error so the user can retry.
    expect(screen.getByTestId("mongo-indexes-panel")).toBeInTheDocument();
  });

  it("does not fetch when database or collection is empty (placeholder mount)", () => {
    render(
      <MongoIndexesPanel connectionId="conn-mongo" database="" collection="" />,
    );
    expect(listMongoIndexesMock).not.toHaveBeenCalled();
  });

  it("delays the loading flag until 1000ms have elapsed (useDelayedFlag gate)", async () => {
    vi.useFakeTimers();
    try {
      // The promise stays pending so `loading` stays true the whole time;
      // we assert that `aria-busy` only flips to "true" after crossing the
      // 1-second threshold.
      let resolveFn: (rows: unknown[]) => void = () => {};
      listMongoIndexesMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFn = resolve as (rows: unknown[]) => void;
          }),
      );

      render(
        <MongoIndexesPanel
          connectionId="conn-mongo"
          database="app"
          collection="users"
        />,
      );

      const panel = screen.getByTestId("mongo-indexes-panel");
      // Before the threshold: aria-busy must NOT be true (no flash).
      expect(panel.getAttribute("aria-busy")).not.toBe("true");

      act(() => {
        vi.advanceTimersByTime(1100);
      });

      expect(panel.getAttribute("aria-busy")).toBe("true");

      // Settle the promise so the panel can resolve cleanly.
      act(() => {
        resolveFn([]);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
