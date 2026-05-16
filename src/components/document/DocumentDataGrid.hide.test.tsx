// Sprint 317 (2026-05-15) — Slice D.1: Mongo DataGrid hide column.
//
// 작성 이유: `useHiddenColumns` + `HeaderRow.onHideColumn` 의 wire-up
// 이 grid 차원에서 (a) hidden column 이 header/row 에서 모두 사라지고
// (b) badge + Show all 이 노출/복원하며 (c) localStorage key
// `hidden-columns:document:<db>:<coll>` 에 persist 되는 회귀를 lock.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId", category: "unknown" },
      { name: "name", data_type: "string", category: "unknown" },
      { name: "email", data_type: "string", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", "alice@example.com"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob", "bob@example.com"],
    ],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        email: "alice@example.com",
      },
      {
        _id: { $oid: "65abcdef0123456789abcde0" },
        name: "Bob",
        email: "bob@example.com",
      },
    ],
    total_count: 2,
    execution_time_ms: 2,
  };
}

const findMock =
  vi.fn<
    (
      ...args: [string, string, string, unknown?]
    ) => Promise<DocumentQueryResult>
  >();

vi.mock("@lib/tauri", () => ({
  listMongoDatabases: vi.fn(() => Promise.resolve([])),
  listMongoCollections: vi.fn(() => Promise.resolve([])),
  inferCollectionFields: vi.fn(() => Promise.resolve([])),
  findDocuments: (...args: [string, string, string, unknown?]) =>
    findMock(...args),
  insertDocument: vi.fn(() => Promise.resolve({})),
  updateDocument: vi.fn(() => Promise.resolve()),
  deleteDocument: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  __resetDocumentStoreForTests();
  window.localStorage.clear();
  findMock.mockReset();
  findMock.mockResolvedValue(buildResult());
});

function renderGrid() {
  return render(
    <DocumentDataGrid
      connectionId="conn-mongo"
      database="table_view_test"
      collection="users"
    />,
  );
}

function getHeader(columnName: string) {
  return screen.getByTitle(`Sort by ${columnName}`);
}

function queryHeader(columnName: string) {
  return screen.queryByTitle(`Sort by ${columnName}`);
}

function rightClickHeader(columnName: string) {
  const header = getHeader(columnName);
  fireEvent.contextMenu(header);
  return header;
}

describe("DocumentDataGrid — hide column (Sprint 317 D.1)", () => {
  it("renders no badge initially and shows all three columns", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // No hidden columns → no badge mounted.
    expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();

    // All three headers present.
    expect(getHeader("_id")).toBeInTheDocument();
    expect(getHeader("name")).toBeInTheDocument();
    expect(getHeader("email")).toBeInTheDocument();
  });

  it("Hide column removes the column from header AND row cells, surfaces a badge", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    rightClickHeader("email");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));

    // email column header should disappear from the grid.
    await waitFor(() => {
      expect(queryHeader("email")).toBeNull();
    });

    // Row cells previously holding email values are gone too.
    expect(screen.queryByText("alice@example.com")).toBeNull();
    expect(screen.queryByText("bob@example.com")).toBeNull();

    // But the remaining columns and their rows survive.
    expect(getHeader("name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();

    // Badge appears.
    const badge = await screen.findByLabelText("Hidden columns badge");
    expect(badge).toHaveTextContent("1 column hidden");
  });

  it("Sprint 369: Hide column never writes hidden-columns:* localStorage (IPC SOT)", async () => {
    const getSpy = vi.spyOn(window.localStorage, "getItem");
    const setSpy = vi.spyOn(window.localStorage, "setItem");
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    rightClickHeader("email");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));

    // Badge appears — UI-level mutation is what users see.
    await waitFor(() =>
      expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
        "1 column hidden",
      ),
    );
    expect(
      window.localStorage.getItem(
        "hidden-columns:document:table_view_test:users",
      ),
    ).toBeNull();
    const reads = getSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    const writes = setSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("hidden-columns:"),
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });

  it("Show all clears every hidden column and removes the badge", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // Hide two columns.
    rightClickHeader("email");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
        "1 column hidden",
      ),
    );
    rightClickHeader("name");
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Hidden columns badge")).toHaveTextContent(
        "2 columns hidden",
      ),
    );

    // Show all.
    fireEvent.click(
      screen.getByRole("button", { name: "Show all hidden columns" }),
    );

    // Badge disappears, columns return.
    await waitFor(() => {
      expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();
    });
    expect(getHeader("name")).toBeInTheDocument();
    expect(getHeader("email")).toBeInTheDocument();

    // localStorage entry is wiped (D-37).
    expect(
      window.localStorage.getItem(
        "hidden-columns:document:table_view_test:users",
      ),
    ).toBeNull();
  });

  // Sprint 369 — mount 시 hydration 은 `get_datagrid_prefs` IPC 가 담당.
  // 본 test 는 backend 가 없는 jsdom 환경 (invoke mock 미설치) 에서는 IPC
  // 응답이 없어 항상 empty 로 hydrate. 자세한 IPC contract 는
  // `src/hooks/useHiddenColumns.test.ts` 가 lock — 여기서는 legacy LS 의
  // 부재만 invariant 로 확인한다.
  it("Sprint 369: legacy hidden-columns:* LS 값 무시 (LS 영속 폐기)", async () => {
    window.localStorage.setItem(
      "hidden-columns:document:table_view_test:users",
      JSON.stringify(["email"]),
    );

    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    // email 은 더 이상 LS 에서 hydrate 되지 않으므로 header 가 노출되어야 함.
    expect(queryHeader("email")).not.toBeNull();
    expect(screen.queryByLabelText("Hidden columns badge")).toBeNull();
  });
});
