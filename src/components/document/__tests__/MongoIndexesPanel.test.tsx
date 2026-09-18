// MongoIndexesPanel: the read-only view plus CRUD — `+ Index` button,
// per-row drop trash, `_id_` disabled tooltip, driver-error surfaces.
//
// Reason: guards the indexes panel in the Mongo collection tab's Structure
// pane — (a) the `+ Index` toggle opens CreateMongoIndexDialog, (b) a
// non-`_id_` row has an active trash button, (c) an `_id_` row is blocked
// with an aria-disabled="true" tooltip, (d) a successful drop refreshes the
// list.

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDocumentCatalogStoreForTests,
  useDocumentCatalogStore,
} from "@/stores/documentCatalogStore";
import { setupTauriMock } from "@/test-utils/tauriMock";
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
  __resetDocumentCatalogStoreForTests();
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

  it("renders cached index inventory without an eager refetch", async () => {
    useDocumentCatalogStore.setState({
      indexesCache: {
        "conn-mongo": {
          app: {
            users: [
              {
                name: "email_1",
                columns: ["email"],
                index_type: "btree",
                is_unique: true,
                is_primary: false,
              },
            ],
          },
        },
      },
    });

    render(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    expect(await screen.findByText("email_1")).toBeInTheDocument();
    expect(listMongoIndexesMock).not.toHaveBeenCalled();
  });

  it("ignores stale index load failures after switching collections", async () => {
    let rejectUsers: (error: Error) => void = () => {};
    listMongoIndexesMock
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectUsers = reject as (error: Error) => void;
          }),
      )
      .mockResolvedValueOnce([
        {
          name: "created_at_1",
          columns: ["created_at"],
          index_type: "btree",
          is_unique: false,
          is_primary: false,
        },
      ]);

    const { rerender } = render(
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

    rerender(
      <MongoIndexesPanel
        connectionId="conn-mongo"
        database="app"
        collection="orders"
      />,
    );
    expect(await screen.findByText("created_at_1")).toBeInTheDocument();

    await act(async () => {
      rejectUsers(new Error("users denied"));
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("mongo-indexes-panel")).toHaveTextContent(
      "Indexes — app.orders",
    );
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
        true,
      );
    });
    await waitFor(() => {
      expect(listMongoIndexesMock).toHaveBeenCalledTimes(2);
    });
  });
});
