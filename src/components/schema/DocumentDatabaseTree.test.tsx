import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocumentDatabaseTree from "./DocumentDatabaseTree";
import {
  useDocumentStore,
  __resetDocumentStoreForTests,
} from "@stores/documentStore";
import { useTabStore } from "@stores/tabStore";

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
});
