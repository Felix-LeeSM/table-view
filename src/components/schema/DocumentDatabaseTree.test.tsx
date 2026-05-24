import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { getAllTabsForConnection } from "@/stores/__tests__/workspaceStoreTestHelpers";
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
} from "@/test-utils/documentStore";
import type { CollectionInfo } from "@/types/document";
import { useWorkspaceStore, type TableTab } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";

function collectionFixture(
  name: string,
  database: string,
  documentCount: number,
): CollectionInfo {
  return {
    name,
    database,
    collection_type: "collection",
    document_count: documentCount,
    read_only: false,
    options: {},
    id_index: null,
  };
}

beforeEach(() => {
  setupTauriMock({
    listMongoDatabases: vi.fn(() =>
      Promise.resolve([{ name: "admin" }, { name: "table_view_test" }]),
    ),
    listMongoCollections: vi.fn((_conn: string, db: string) =>
      Promise.resolve(
        db === "table_view_test"
          ? [collectionFixture("users", "table_view_test", 3)]
          : db === "dbX"
            ? [collectionFixture("x_collection", "dbX", 7)]
            : db === "dbY"
              ? [collectionFixture("y_collection", "dbY", 11)]
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
  });
});

describe("DocumentDatabaseTree", () => {
  beforeEach(() => {
    __resetDocumentStoreForTests();
    useWorkspaceStore.setState({ workspaces: {} });
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

  // Sprint 346 (2026-05-15) — admin/config/local 시스템 DB 는 sidebar 의 맨
  // 아래로 정렬, italic + muted 시각으로 사용자 DB 와 구분. backend 의
  // list_database_names 가 정렬을 보장 안 해 admin 이 맨 위에 떠 사용자
  // 자신의 DB 가 묻히는 UX 회귀를 막는다.
  it("renders system databases (admin/config/local) after user DBs, italic + muted", async () => {
    const tauri = (await import("@lib/tauri")) as unknown as {
      listMongoDatabases: ReturnType<typeof vi.fn>;
    };
    tauri.listMongoDatabases.mockResolvedValueOnce([
      { name: "admin" },
      { name: "local" },
      { name: "config" },
      { name: "zeta_app" },
      { name: "alpha_app" },
    ]);

    render(<DocumentDatabaseTree connectionId="conn-mongo-sys" />);

    await waitFor(() => {
      expect(screen.getByLabelText("alpha_app database")).toBeInTheDocument();
      expect(screen.getByLabelText("admin database")).toBeInTheDocument();
    });

    const dbButtons = screen.getAllByRole("button", {
      name: /database$/,
    });
    const order = dbButtons.map((b) => b.getAttribute("aria-label"));
    expect(order).toEqual([
      "alpha_app database",
      "zeta_app database",
      "admin database",
      "config database",
      "local database",
    ]);

    const adminRow = screen.getByLabelText("admin database");
    expect(adminRow).toHaveAttribute("data-system-db", "true");
    expect(adminRow.className).toMatch(/italic/);
    expect(adminRow.className).toMatch(/opacity-60/);

    const userRow = screen.getByLabelText("alpha_app database");
    expect(userRow).not.toHaveAttribute("data-system-db");
    expect(userRow.className).not.toMatch(/italic/);
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

    const tabs = getAllTabsForConnection("conn-mongo");
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
      // Sprint 265 — nested `(connId, db)` cache shape.
      expect(
        useDocumentStore.getState().collections["conn-mongo"]?.[
          "table_view_test"
        ],
      ).toBeDefined();
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

    const tabs = getAllTabsForConnection("conn-mongo");
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

    const tabs = getAllTabsForConnection("conn-mongo");
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
    const previewId = getAllTabsForConnection("conn-mongo")[0]!.id;
    fireEvent.click(screen.getByLabelText("users collection"));

    const tabs = getAllTabsForConnection("conn-mongo");
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
    // Cache populated under the nested (conn, table_view_test) path.
    expect(
      useDocumentStore.getState().collections["conn-mongo"]?.[
        "table_view_test"
      ],
    ).toBeDefined();

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
    // carries the (conn, table_view_test) path, so a render that doesn't
    // re-fetch can never paint stale `users` rows.
    expect(
      useDocumentStore.getState().collections["conn-mongo"],
    ).toBeUndefined();
    // The collection row from the previous DB is no longer in the DOM —
    // the tree collapsed when the database list re-fetched.
    await waitFor(() =>
      expect(
        screen.queryByLabelText("users collection"),
      ).not.toBeInTheDocument(),
    );
  });

  // ─────────────────────────────────────────────────────────────────
  // Sprint 156 — Phase 13 diagnostic edge cases for document preview.
  // These tests diagnose user-reported Bug 2 (preview tabs accumulate
  // instead of swapping) in the document paradigm context.
  // ─────────────────────────────────────────────────────────────────

  // ADR 0027 (Sprint 262) — per-database workspace partition. The
  // pre-S262 behaviour for this AC was "preview swaps GLOBALLY across
  // databases" because tabs lived in one flat list. Under per-(connId,
  // db) workspaces each database keeps its own preview slot, so
  // clicking collections in two distinct databases yields TWO preview
  // tabs (one per workspace). This is the new contract; the legacy
  // swap is no longer reachable.
  it("AC-156-doc-01 (post-S262): clicking collections in different databases keeps a preview per-database", async () => {
    const tauriMock = await import("@lib/tauri");
    const listDatabasesSpy = vi.mocked(tauriMock.listMongoDatabases);
    listDatabasesSpy.mockResolvedValueOnce([{ name: "dbX" }, { name: "dbY" }]);

    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(screen.getByLabelText("dbX database")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("dbX database"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("x_collection collection"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("dbY database"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("y_collection collection"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("x_collection collection"));
    fireEvent.click(screen.getByLabelText("y_collection collection"));

    const tabs = getAllTabsForConnection("conn-mongo");
    expect(tabs).toHaveLength(2);
    const xTab = tabs.find(
      (t): t is TableTab => t.type === "table" && t.database === "dbX",
    );
    const yTab = tabs.find(
      (t): t is TableTab => t.type === "table" && t.database === "dbY",
    );
    expect(xTab?.isPreview).toBe(true);
    expect(xTab?.collection).toBe("x_collection");
    expect(yTab?.isPreview).toBe(true);
    expect(yTab?.collection).toBe("y_collection");
  });

  // Reason: double-click promote 후 다른 collection 클릭 시 permanent + preview
  //         2개 탭이 생성되어야 함. relational 트리와 동일한 semantics (2026-04-28)
  it("AC-156-doc-02: double-click promotion then clicking a different collection creates permanent + preview", async () => {
    // Override mock to include both table_view_test and dbX.
    const tauriMock = await import("@lib/tauri");
    const listDatabasesSpy = vi.mocked(tauriMock.listMongoDatabases);
    listDatabasesSpy.mockResolvedValueOnce([
      { name: "table_view_test" },
      { name: "dbX" },
    ]);

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

    // Double-click to promote.
    fireEvent.doubleClick(screen.getByLabelText("users collection"));
    const tabs = getAllTabsForConnection("conn-mongo");
    expect(tabs).toHaveLength(1);
    const promoted = tabs[0]!;
    if (promoted.type === "table") {
      expect(promoted.isPreview).toBe(false);
      expect(promoted.collection).toBe("users");
    }

    // Now expand dbX and click a different collection.
    await waitFor(() =>
      expect(screen.getByLabelText("dbX database")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("dbX database"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("x_collection collection"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("x_collection collection"));

    const tabs2 = getAllTabsForConnection("conn-mongo");
    expect(tabs2).toHaveLength(2);
    // Find the permanent and preview tabs.
    const permanent = tabs2.find(
      (t): t is TableTab => t.type === "table" && t.isPreview !== true,
    );
    const preview = tabs2.find(
      (t): t is TableTab => t.type === "table" && t.isPreview === true,
    );
    if (permanent && permanent.type === "table") {
      expect(permanent.isPreview).toBe(false);
      expect(permanent.collection).toBe("users");
    }
    if (preview && preview.type === "table") {
      expect(preview.isPreview).toBe(true);
      expect(preview.collection).toBe("x_collection");
    }
  });

  // Reason: promote 후 같은 collection 다시 클릭해도 새 탭이 생기지 않아야 함.
  //         exact match가 동작하는지 확인 (2026-04-28)
  it("AC-156-doc-03: after promoting, clicking the same collection again is idempotent", async () => {
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

    // Double-click to promote.
    fireEvent.doubleClick(screen.getByLabelText("users collection"));

    // Click the same collection again — must not create a second tab.
    fireEvent.click(screen.getByLabelText("users collection"));

    const tabs = getAllTabsForConnection("conn-mongo");
    expect(tabs).toHaveLength(1);
    const tab = tabs[0]!;
    if (tab.type === "table") {
      expect(tab.isPreview).toBe(false);
      expect(tab.collection).toBe("users");
    }
  });

  // ADR 0027 (Sprint 262) — see AC-156-doc-01 comment above. Phase 13's
  // AC-13-06 tested the same legacy "global preview swap" that no
  // longer applies once tabs are partitioned by `(connId, db)`. The
  // updated contract: each database keeps its own preview slot
  // independently, and clicking collections in two databases yields
  // one preview per database. Same coverage as AC-156-doc-01 above,
  // retained here so the Phase 13 reference is preserved in tests.
  it("AC-13-06 (post-S262): keeps a preview slot per-database (same connection)", async () => {
    const tauriMock = await import("@lib/tauri");
    const listDatabasesSpy = vi.mocked(tauriMock.listMongoDatabases);
    listDatabasesSpy.mockResolvedValueOnce([{ name: "dbX" }, { name: "dbY" }]);

    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(screen.getByLabelText("dbX database")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("dbX database"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("x_collection collection"),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText("dbY database"));
    await waitFor(() =>
      expect(
        screen.getByLabelText("y_collection collection"),
      ).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByLabelText("x_collection collection"));
    fireEvent.click(screen.getByLabelText("y_collection collection"));

    const tabs = getAllTabsForConnection("conn-mongo");
    expect(tabs).toHaveLength(2);
    const xTab = tabs.find(
      (t): t is TableTab => t.type === "table" && t.database === "dbX",
    );
    const yTab = tabs.find(
      (t): t is TableTab => t.type === "table" && t.database === "dbY",
    );
    expect(xTab?.isPreview).toBe(true);
    expect(xTab?.collection).toBe("x_collection");
    expect(yTab?.isPreview).toBe(true);
    expect(yTab?.collection).toBe("y_collection");
  });

  // Sprint 330 (Slice DB-Scope.3) — sidebar 우클릭으로 mongosh query tab
  // 을 spawn. TabDbChip popover (Sprint 329) 가 가리키는 entry-point.
  // 작성 이유: 사용자가 "다른 DB 에서 query 하고 싶다" 를 마음 먹었을 때
  // 가는 단일 진입점이 이 우클릭. 다른 곳에는 같은 액션이 없어야 한다
  // (toolbar DbSwitcher 는 Sprint 328 에서 hide, TabDbChip 은 Sprint 329
  // 에서 display only).
  it("Sprint 330: right-click on a database row spawns a mongosh query tab for that database", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo" />);

    await waitFor(() =>
      expect(
        screen.getByLabelText("table_view_test database"),
      ).toBeInTheDocument(),
    );
    const row = screen.getByLabelText("table_view_test database");

    fireEvent.contextMenu(row);

    const menuItem = await screen.findByRole("menuitem", {
      name: /new query here/i,
    });
    await act(async () => {
      fireEvent.click(menuItem);
    });

    const tabs = getAllTabsForConnection("conn-mongo");
    expect(tabs).toHaveLength(1);
    const queryTab = tabs[0]!;
    expect(queryTab.type).toBe("query");
    if (queryTab.type === "query") {
      expect(queryTab.paradigm).toBe("document");
      expect(queryTab.database).toBe("table_view_test");
      expect(queryTab.sql).toBe("");
    }
  });
});
