// Sprint 260 (2026-05-11) — AC-260-02: DocumentDataGrid drag-resize 확대.
// RDB DataGridTable 와 같은 harness 패턴 (mousedown handle → mousemove
// document → --cols 첫 token 만 증가, 인접 column 불변). Document grid 의
// resize 결과는 `document:<db>:<coll>` localStorage 에 persist.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
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

  // Sprint 369 (Phase 4) — `column-widths:document:<db>:<coll>` LS 영속 폐기.
  // drag end 시 `set_datagrid_prefs` IPC 가 widths-only patch 를 보내며 LS 는
  // 0회 read/write. IPC body 의 자세한 contract (PK / patch shape) 는
  // `src/hooks/useColumnWidths.test.ts` 가 lock.
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
