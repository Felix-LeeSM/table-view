// AC-260-02: widens DocumentDataGrid drag-resize. Same harness pattern as
// the RDB DataGridTable (mousedown handle → mousemove document → only the
// first `--cols` token grows, adjacent column unchanged). The Document
// grid's resize result persists through the `set_datagrid_prefs` IPC, not
// localStorage.

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DocumentQueryResult } from "@/types/document";
import DocumentDataGrid from "./DocumentDataGrid";

const findMock =
  vi.fn<
    (
      ...args: [string, string, string, unknown?]
    ) => Promise<DocumentQueryResult>
  >();
beforeEach(() => {
  setupTauriMock({
    listMongoDatabases: vi.fn(() => Promise.resolve([])),
    listMongoCollections: vi.fn(() => Promise.resolve([])),
    inferCollectionFields: vi.fn(() => Promise.resolve([])),
    findDocuments: (...args: [string, string, string, unknown?]) =>
      findMock(...args),
    insertDocument: vi.fn(() => Promise.resolve({})),
    updateDocument: vi.fn(() => Promise.resolve()),
    deleteDocument: vi.fn(() => Promise.resolve()),
  });
});

function buildResult(): DocumentQueryResult {
  return {
    columns: [
      { name: "_id", dataType: "ObjectId", category: "uuid" },
      { name: "name", dataType: "string", category: "text" },
    ],
    rows: [
      [{ $oid: "65abcdef0123456789abcdef" }, "Alice"],
      [{ $oid: "65abcdef0123456789abcde0" }, "Bob"],
    ],
    rawDocuments: [
      { _id: { $oid: "65abcdef0123456789abcdef" }, name: "Alice" },
      { _id: { $oid: "65abcdef0123456789abcde0" }, name: "Bob" },
    ],
    totalCount: 2,
    executionTimeMs: 1,
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

  // `column-widths:document:<db>:<coll>` LS persistence is dropped. On drag
  // end the `set_datagrid_prefs` IPC sends a widths-only patch and LS sees
  // zero reads/writes. The detailed IPC body contract (PK / patch shape) is
  // locked by `src/hooks/useColumnWidths.test.ts`.
  it("drag end 시 LS 의 column-widths:* key 를 만들지 않는다 (Sprint 369)", async () => {
    const getSpy = vi.spyOn(window.localStorage, "getItem");
    const setSpy = vi.spyOn(window.localStorage, "setItem");
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

    expect(
      window.localStorage.getItem("column-widths:document:t:users"),
    ).toBeNull();
    const reads = getSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("column-widths:"),
    );
    const writes = setSpy.mock.calls.filter((c) =>
      String(c[0]).startsWith("column-widths:"),
    );
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
