import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import DocumentDatabaseTree from "./DocumentDatabaseTree";
import {
  useDocumentStore,
  __resetDocumentStoreForTests,
} from "@stores/documentStore";
import { useTabStore } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";

// Mock the tauri bridge so the store actions resolve against canned data
// instead of invoking the backend.
vi.mock("@lib/tauri", () => ({
  listMongoDatabases: vi.fn(() =>
    Promise.resolve([{ name: "admin" }, { name: "table_view_test" }]),
  ),
  listMongoCollections: vi.fn((_conn: string, db: string) =>
    Promise.resolve(
      db === "table_view_test"
        ? [
            {
              name: "users",
              database: "table_view_test",
              document_count: 3,
            },
          ]
        : db === "dbX"
          ? [
              {
                name: "x_collection",
                database: "dbX",
                document_count: 7,
              },
            ]
          : db === "dbY"
            ? [
                {
                  name: "y_collection",
                  database: "dbY",
                  document_count: 11,
                },
              ]
            : [],
    ),
  ),
  inferCollectionFields: vi.fn(() => Promise.resolve([])),
  findDocuments: vi.fn(() =>
    Promise.resolve({
      columns: [],
      rows: [],
      raw_documents: [],
      total_count: 0,
      execution_time_ms: 0,
    }),
  ),
}));

describe("DocumentDatabaseTree", () => {
  beforeEach(() => {
    __resetDocumentStoreForTests();
    useTabStore.setState({ tabs: [], activeTabId: null });
    // Sprint 137 — reset the connection store so previous tests' active DB
    // selections cannot leak into the auto-load guard.
    useConnectionStore.setState({ activeStatuses: {}, connections: [] });
  });

  it("loads and renders the database list on mount", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() => {
      expect(screen.getByLabelText("admin database")).toBeInTheDocument();
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument();
    });
  });

  it("expanding a database node lazy-loads its collections", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("table_view_test database"));

    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );
  });

  it("double-clicking a collection opens a document-paradigm TableTab", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("table_view_test database"));

    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );

    fireEvent.doubleClick(screen.getByLabelText("users collection"));

    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const first = tabs[0]!;
    expect(first.type).toBe("table");
    if (first.type === "table") {
      expect(first.paradigm).toBe("document");
      // Sprint 129 — addTab must populate the new dedicated fields…
      expect(first.database).toBe("table_view_test");
      expect(first.collection).toBe("users");
      // …and keep the legacy schema/table for backwards-compat with any
      // reader that hasn't migrated yet.
      expect(first.schema).toBe("table_view_test");
      expect(first.table).toBe("users");
      expect(first.title).toBe("table_view_test.users");
    }
  });

  it("shows a loading state while the database list resolves", async () => {
    // First render will trigger the default mock (fast); instead, assert
    // the loader node exists after render but before waitFor settles.
    const { container } = render(
      <DocumentDatabaseTree connectionId="conn-loading" />,
    );
    // The "Loading databases..." status shows while loadingRoot is true.
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    // Eventually the databases appear.
    await waitFor(() =>
      expect(screen.getByLabelText("admin database")).toBeInTheDocument(),
    );
  });

  it("populates the store's collections cache on expand", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("table_view_test database"));

    await waitFor(() => {
      const key = "conn-mongo:table_view_test";
      expect(useDocumentStore.getState().collections[key]).toBeDefined();
    });
  });

  // -- Sprint 129 --

  it("renders the search input with the documented aria-label", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    const input = screen.getByLabelText("Filter databases and collections");
    expect(input).toBeInTheDocument();
    // Initial value is empty so all databases pass through unchanged.
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("filters databases by case-insensitive substring match", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() => {
      expect(screen.getByLabelText("admin database")).toBeInTheDocument();
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument();
    });

    const input = screen.getByLabelText("Filter databases and collections");
    fireEvent.change(input, { target: { value: "AD" } });

    expect(screen.getByLabelText("admin database")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("table_view_test database"),
    ).not.toBeInTheDocument();
  });

  it("renders 'No databases match' when the filter yields zero results", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(screen.getByLabelText("admin database")).toBeInTheDocument(),
    );

    const input = screen.getByLabelText("Filter databases and collections");
    fireEvent.change(input, { target: { value: "zzzz-no-match" } });

    expect(
      screen.getByText(/No databases match "zzzz-no-match"/),
    ).toBeInTheDocument();
    // Sanity — the original empty-state message must NOT render here.
    expect(
      screen.queryByText("No databases visible to this connection"),
    ).not.toBeInTheDocument();
  });

  it("auto-expands a database whose collections match the query", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );

    // Pre-load the collection cache so the search has data to match against.
    fireEvent.click(screen.getByLabelText("table_view_test database"));
    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );
    // Collapse it again so we can verify the search expands automatically.
    fireEvent.click(screen.getByLabelText("table_view_test database"));
    await waitFor(() =>
      expect(
        screen.queryByLabelText("users collection"),
      ).not.toBeInTheDocument(),
    );

    const input = screen.getByLabelText("Filter databases and collections");
    fireEvent.change(input, { target: { value: "user" } });

    // The collection match auto-expands the parent database, so the
    // collection node is visible without any extra click.
    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );
    // The non-matching `admin` database is hidden (no collection match
    // either, since we never expanded it).
    expect(screen.queryByLabelText("admin database")).not.toBeInTheDocument();
  });

  it("does not render the Folder/FolderOpen icon (sprint 129)", async () => {
    const { container } = render(
      <DocumentDatabaseTree connectionId="conn-mongo" />,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("admin database")).toBeInTheDocument(),
    );

    // lucide-react renders icons as <svg class="lucide lucide-folder ...">.
    // Verify the RDB-folder metaphor is gone — both the closed and the
    // open variant must be absent.
    expect(container.querySelector("svg.lucide-folder")).toBeNull();
    expect(container.querySelector("svg.lucide-folder-open")).toBeNull();

    // The Database icon, on the other hand, must still render once per
    // database row.
    const dbIcons = container.querySelectorAll("svg.lucide-database");
    expect(dbIcons.length).toBeGreaterThanOrEqual(2);
  });

  // ─────────────────────────────────────────────────────────────────
  // Sprint 135 — AC-S135-05 regression guard.
  // The Mongo sidebar must stay at exactly 2 levels (database →
  // collection). If a future sprint accidentally introduces a "schema"
  // layer between database and collection (or flattens the tree), this
  // test fails before the user sees a regression.
  // ─────────────────────────────────────────────────────────────────
  it("renders database → collection (2-level tree, no schema layer) — AC-S135-05", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    // Level 1 — the database row is visible after the initial load.
    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );

    // Expand the database to reveal level 2.
    fireEvent.click(screen.getByLabelText("table_view_test database"));

    // Level 2 — the collection row appears directly under the database.
    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );

    // No "schema" row may exist between the two levels — the document
    // paradigm has no schema concept and a stray `*-schema` aria-label
    // would indicate a regression to the relational tree shape.
    expect(screen.queryByLabelText(/schema$/i)).toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────
  // Sprint 136 — preview / persist click semantics for the document
  // tree. Mirrors the relational tree's AC-S136-01..04 so click
  // semantics are paradigm-agnostic.
  // ─────────────────────────────────────────────────────────────────

  it("AC-S136-03: single-click on a collection opens a preview tab (isPreview=true)", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("table_view_test database"));
    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("users collection"));

    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const first = tabs[0]!;
    expect(first.type).toBe("table");
    if (first.type === "table") {
      expect(first.isPreview).toBe(true);
      expect(first.paradigm).toBe("document");
      expect(first.collection).toBe("users");
    }
  });

  it("AC-S136-03: double-click on a collection promotes the tab (isPreview=false)", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("table_view_test database"));
    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );

    fireEvent.doubleClick(screen.getByLabelText("users collection"));

    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    const first = tabs[0]!;
    expect(first.type).toBe("table");
    if (first.type === "table") {
      // Promote stuck — the tab is no longer a preview.
      expect(first.isPreview).toBe(false);
      expect(first.paradigm).toBe("document");
      expect(first.collection).toBe("users");
    }
  });

  it("AC-S136-04: same-collection single-click twice is idempotent (no extra tab, no promote)", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("table_view_test database"));
    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("users collection"));
    const previewId = useTabStore.getState().tabs[0]!.id;
    fireEvent.click(screen.getByLabelText("users collection"));

    const tabs = useTabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.id).toBe(previewId);
    const first = tabs[0]!;
    if (first.type === "table") {
      expect(first.isPreview).toBe(true);
    }
  });

  it("Escape clears the search query", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(screen.getByLabelText("admin database")).toBeInTheDocument(),
    );

    const input = screen.getByLabelText(
      "Filter databases and collections",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "admin" } });
    expect(input.value).toBe("admin");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    // After clearing, the previously-hidden database is visible again.
    expect(
      screen.getByLabelText("table_view_test database"),
    ).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────────
  // Sprint 137 — AC-S137-02: Mongo DB swap (DbSwitcher) must invalidate
  // the document store cache and trigger an immediate re-fetch so the
  // sidebar reflects the new DB. The 2026-04-27 user check found that
  // the previous code path stayed pinned to the connection's default
  // DB after a `switch_active_db` because the auto-load guard short-
  // circuited on identical `connectionId`.
  // ─────────────────────────────────────────────────────────────────

  it("AC-S137-02: re-fetches the database list when the user-active DB changes (DB swap invalidates cache)", async () => {
    const tauriMock = await import("@lib/tauri");
    const listDatabasesSpy = vi.mocked(tauriMock.listMongoDatabases);
    listDatabasesSpy.mockClear();

    // Seed the connection as connected with `dbX` so the initial render
    // matches what the DbSwitcher would have written immediately after
    // a successful `switch_active_db("dbX")` dispatch.
    useConnectionStore.setState({
      activeStatuses: {
        "conn-mongo": { type: "connected", activeDb: "dbX" },
      },
    });

    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    // First fetch — driven by the initial mount, keyed off `(conn-mongo, dbX)`.
    await waitFor(() => {
      expect(listDatabasesSpy).toHaveBeenCalledWith("conn-mongo");
      expect(listDatabasesSpy).toHaveBeenCalledTimes(1);
    });

    // Simulate the DbSwitcher swap pipeline:
    //   1. `clearConnection(id)` wipes the document store cache.
    //   2. `setActiveDb(id, "dbY")` flips the connection's active DB slot.
    // The tree's auto-load effect must re-fire because its guard now
    // depends on the active DB, not just the connection id.
    await act(async () => {
      useDocumentStore.getState().clearConnection("conn-mongo");
      useConnectionStore.setState({
        activeStatuses: {
          "conn-mongo": { type: "connected", activeDb: "dbY" },
        },
      });
    });

    await waitFor(() => {
      expect(listDatabasesSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("AC-S137-02: clearing the document store cache on DB swap drops stale collections (no leak across DBs)", async () => {
    const tauriMock = await import("@lib/tauri");
    const listCollectionsSpy = vi.mocked(tauriMock.listMongoCollections);
    listCollectionsSpy.mockClear();

    // Start on activeDb="dbX". The user expanding a DB row (table_view_test
    // here, since it's the one with non-empty collections in the mock)
    // populates the document store's collection cache.
    useConnectionStore.setState({
      activeStatuses: {
        "conn-mongo": { type: "connected", activeDb: "dbX" },
      },
    });
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);
    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("table_view_test database"));
    await waitFor(() =>
      expect(screen.getByLabelText("users collection")).toBeInTheDocument(),
    );
    // Cache populated under the (conn, table_view_test) key.
    const beforeKey = "conn-mongo:table_view_test";
    expect(useDocumentStore.getState().collections[beforeKey]).toBeDefined();

    // DbSwitcher swap pipeline — clear cache then flip activeDb.
    await act(async () => {
      useDocumentStore.getState().clearConnection("conn-mongo");
      useConnectionStore.setState({
        activeStatuses: {
          "conn-mongo": { type: "connected", activeDb: "dbY" },
        },
      });
    });

    // Stale collections for the prior DB are gone — the cache no longer
    // carries the (conn, table_view_test) key, so a render that doesn't
    // re-fetch can never paint stale `users` rows.
    expect(useDocumentStore.getState().collections[beforeKey]).toBeUndefined();
    // The collection row from the previous DB is no longer in the DOM —
    // the tree collapsed when the database list re-fetched.
    await waitFor(() =>
      expect(
        screen.queryByLabelText("users collection"),
      ).not.toBeInTheDocument(),
    );
  });
});
