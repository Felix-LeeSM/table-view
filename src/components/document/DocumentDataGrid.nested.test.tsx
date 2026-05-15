// Sprint 321 (2026-05-15) — Slice F.1: DocumentDataGrid sentinel cell
// expand popover 통합.
//
// 작성 이유: sentinel cell ({...} / [N items]) 옆에 "Expand nested"
// 트리거가 마운트되고, 일반 cell 에는 미노출되며, 트리거 클릭이
// row selection 으로 propagate 되지 않는지를 회귀 가드.

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
      { name: "meta", data_type: "document", category: "unknown" },
      { name: "tags", data_type: "array", category: "unknown" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice", "{...}", "[3 items]"],
    ],
    raw_documents: [
      {
        _id: { $oid: "65abcdef0123456789abcdef" },
        name: "Alice",
        meta: { verified: true, role: "admin" },
        tags: ["alpha", "beta", "gamma"],
      },
    ],
    total_count: 1,
    execution_time_ms: 1,
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

describe("DocumentDataGrid — nested expand (Sprint 321 F.1)", () => {
  it("mounts the expand trigger on sentinel cells (meta and tags)", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    expect(
      screen.getByRole("button", { name: "Expand nested meta" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand nested tags" }),
    ).toBeInTheDocument();
  });

  it("does not mount the trigger for scalar cells", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    expect(
      screen.queryByRole("button", { name: "Expand nested name" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Expand nested _id" }),
    ).toBeNull();
  });

  it("opens the popover with object entries on click", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    const region = await screen.findByRole("region", {
      name: "Nested fields for meta",
    });
    expect(region).toHaveTextContent("verified");
    expect(region).toHaveTextContent("true");
    expect(region).toHaveTextContent("role");
    expect(region).toHaveTextContent("admin");
  });

  it("opens the popover with array entries on click (tags)", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Expand nested tags" }));
    const region = await screen.findByRole("region", {
      name: "Nested fields for tags",
    });
    expect(region).toHaveTextContent("[0]");
    expect(region).toHaveTextContent("alpha");
    expect(region).toHaveTextContent("[2]");
    expect(region).toHaveTextContent("gamma");
  });

  it("trigger click does not toggle row selection", async () => {
    renderGrid();
    await waitFor(() => expect(screen.getByText("Alice")).toBeInTheDocument());

    const row = screen.getByText("Alice").closest('[role="row"]')!;
    expect(row).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("button", { name: "Expand nested meta" }));
    expect(row).toHaveAttribute("aria-selected", "false");
  });
});
