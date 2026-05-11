// Sprint 260 (2026-05-11) — AC-260-02: DocumentDataGrid drag-resize 확대.
// RDB DataGridTable 와 같은 harness 패턴 (mousedown handle → mousemove
// document → --cols 첫 token 만 증가, 인접 column 불변). Document grid 의
// resize 결과는 `document:<db>:<coll>` localStorage 에 persist.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor } from "@testing-library/react";
import DocumentDataGrid from "./DocumentDataGrid";
import { __resetDocumentStoreForTests } from "@stores/documentStore";
import type { DocumentQueryResult } from "@/types/document";

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

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", data_type: "ObjectId", category: "uuid" },
      { name: "name", data_type: "string", category: "text" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob"],
    ],
    raw_documents: [
      { _id: { $oid: "65abcdef0123456789abcdef" }, name: "Alice" },
      { _id: { $oid: "65abcdef0123456789abcde0" }, name: "Bob" },
    ],
    total_count: 2,
    execution_time_ms: 1,
  };
}

beforeEach(() => {
  __resetDocumentStoreForTests();
  findMock.mockReset();
  findMock.mockResolvedValue(buildResult());
  window.localStorage.clear();
});

afterEach(() => {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
});

function getResizeHandles(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(".cursor-col-resize"),
  ) as HTMLElement[];
}

function getOuterGrid(): HTMLElement {
  const el = document.querySelector('[role="grid"]') as HTMLElement | null;
  if (!el) throw new Error("outer role=grid not found");
  return el;
}

function parseColsPx(outer: HTMLElement): number[] {
  const raw = outer.style.getPropertyValue("--cols").trim();
  if (!raw) return [];
  return raw.split(/\s+/).map((tok) => parseFloat(tok));
}

describe("DocumentDataGrid — column resize (Sprint 260 AC-260-02)", () => {
  it("renders one resize handle per visible column", async () => {
    render(
      <DocumentDataGrid
        connectionId="conn-mongo"
        database="t"
        collection="users"
      />,
    );
    await waitFor(() =>
      expect(document.querySelector('[role="grid"]')).toBeTruthy(),
    );

    const handles = getResizeHandles();
    expect(handles.length).toBe(2);
  });

  it("drag → mouseup 가 자기 column --cols px 만 증가시키고 인접은 불변", async () => {
    render(
      <DocumentDataGrid
        connectionId="conn-mongo"
        database="t"
        collection="users"
      />,
    );
    await waitFor(() =>
      expect(document.querySelector('[role="grid"]')).toBeTruthy(),
    );

    const handle = getResizeHandles()[0]!;
    const before = parseColsPx(getOuterGrid());
    expect(before.length).toBe(2);

    act(() => {
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
        }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 250 }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 250 }),
      );
    });

    const after = parseColsPx(getOuterGrid());
    expect(after.length).toBe(2);
    expect(after[0]!).toBeGreaterThan(before[0]!);
    expect(after[1]!).toBe(before[1]!);
  });

  it("drag 결과가 document:<db>:<coll> localStorage 에 persist", async () => {
    render(
      <DocumentDataGrid
        connectionId="conn-mongo"
        database="t"
        collection="users"
      />,
    );
    await waitFor(() =>
      expect(document.querySelector('[role="grid"]')).toBeTruthy(),
    );

    const handle = getResizeHandles()[0]!;
    act(() => {
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
        }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 300 }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 300 }),
      );
    });

    const raw = window.localStorage.getItem("column-widths:document:t:users");
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? "{}") as Record<string, number>;
    expect(typeof stored._id).toBe("number");
    expect(stored._id!).toBeGreaterThan(0);
  });
});
