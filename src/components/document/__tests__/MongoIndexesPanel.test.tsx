// Sprint 350 (2026-05-15) — Tracer: MongoIndexesPanel read-only.
// Sprint 351 (2026-05-15) — CRUD extension: `+ Index` button + per-row
// drop trash + `_id_` disabled tooltip + driver-error surfaces.
//
// 작성 이유: 본 sprint 가 Mongo collection tab 의 Structure pane 의 indexes
// 패널에 (a) `+ Index` 토글이 CreateMongoIndexDialog 를 띄우고, (b) 비-`_id_`
// 행은 trash 버튼이 활성, (c) `_id_` 행은 aria-disabled="true" tooltip 으로
// 차단, (d) drop 성공 시 list refresh 가 일어남을 검증한다. Sprint 350 의 5
// RO 시나리오는 그대로 유지하면서 추가.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MongoIndexesPanel } from "../MongoIndexesPanel";

const listMongoIndexesMock = vi.fn();
const createMongoIndexMock = vi.fn();
const dropMongoIndexMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    listMongoIndexes: (...args: unknown[]) => listMongoIndexesMock(...args),
    createMongoIndex: (...args: unknown[]) => createMongoIndexMock(...args),
    dropMongoIndex: (...args: unknown[]) => dropMongoIndexMock(...args),
  });
});

beforeEach(() => {
  listMongoIndexesMock.mockReset();
  createMongoIndexMock.mockReset();
  dropMongoIndexMock.mockReset();
});

describe("MongoIndexesPanel (Sprint 350 — tracer RO list)", () => {
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
      expect(panel.getAttribute("aria-busy")).not.toBe("true");

      act(() => {
        vi.advanceTimersByTime(1100);
      });

      expect(panel.getAttribute("aria-busy")).toBe("true");

      act(() => {
        resolveFn([]);
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MongoIndexesPanel (Sprint 351 — CRUD affordances)", () => {
  const baseRows = [
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
  ];

  it("renders a `+ Index` toolbar button with testid mongo-indexes-create", async () => {
    listMongoIndexesMock.mockResolvedValueOnce(baseRows);
    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );
    const btn = await screen.findByTestId("mongo-indexes-create");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent(/index/i);
  });

  it("renders a trash button per row with testid mongo-index-drop-{name}; `_id_` row is aria-disabled", async () => {
    listMongoIndexesMock.mockResolvedValueOnce(baseRows);
    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );
    const idDrop = await screen.findByTestId("mongo-index-drop-_id_");
    expect(idDrop).toHaveAttribute("aria-disabled", "true");

    const emailDrop = screen.getByTestId("mongo-index-drop-email_1");
    expect(emailDrop).not.toHaveAttribute("aria-disabled", "true");
  });

  it("opens the CreateMongoIndexDialog when the `+ Index` button is clicked", async () => {
    listMongoIndexesMock.mockResolvedValueOnce(baseRows);
    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );
    const btn = await screen.findByTestId("mongo-indexes-create");
    await userEvent.click(btn);
    expect(
      await screen.findByTestId("mongo-create-index-dialog"),
    ).toBeInTheDocument();
  });

  it("opens the DropMongoIndexDialog when a non-`_id_` trash button is clicked", async () => {
    listMongoIndexesMock.mockResolvedValueOnce(baseRows);
    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );
    const drop = await screen.findByTestId("mongo-index-drop-email_1");
    await userEvent.click(drop);
    expect(
      await screen.findByTestId("mongo-drop-index-dialog"),
    ).toBeInTheDocument();
  });

  it("re-fetches the list after a successful drop (refresh wire-up)", async () => {
    listMongoIndexesMock.mockResolvedValueOnce(baseRows);
    dropMongoIndexMock.mockResolvedValueOnce(undefined);
    listMongoIndexesMock.mockResolvedValueOnce([
      // post-drop snapshot: email_1 removed.
      baseRows[0],
    ]);
    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );
    const drop = await screen.findByTestId("mongo-index-drop-email_1");
    await userEvent.click(drop);
    const typing = await screen.findByTestId("mongo-drop-index-typing");
    fireEvent.change(typing, { target: { value: "email_1" } });
    const confirm = screen.getByTestId("mongo-drop-index-confirm");
    await userEvent.click(confirm);
    await waitFor(() => {
      expect(dropMongoIndexMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        "email_1",
      );
    });
    await waitFor(() => {
      expect(listMongoIndexesMock).toHaveBeenCalledTimes(2);
    });
  });
});
