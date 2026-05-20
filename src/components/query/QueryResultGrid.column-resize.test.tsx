// Sprint 260 (2026-05-11) — AC-260-02: QueryResultGrid (read-only) drag-resize.
// Read-only grid 이라 localStorage persist 는 안 함 — drag 결과는 in-memory only.
// Query 류는 결과가 일시적이라 (다음 query 마다 columns 바뀜) stable identity 가
// 없어 persistenceKey 없이 호출.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, act } from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "@/types/query";
import { useSchemaStore } from "@stores/schemaStore";
beforeEach(() => {
  setupTauriMock({
    getTableColumns: vi.fn(async () => []),
    executeQuery: vi.fn(async () => ({})),
  });
});

const SELECT_RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "int" },
    { name: "name", dataType: "text", category: "text" },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  totalCount: 2,
  executionTimeMs: 1,
  queryType: "select",
};

beforeEach(() => {
  useSchemaStore.setState({ tableColumnsCache: {} });
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

describe("QueryResultGrid — column resize (Sprint 260 AC-260-02)", () => {
  it("read-only SELECT 결과의 header 가 column 별 resize handle 을 노출", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
    );
    expect(getResizeHandles().length).toBe(2);
  });

  it("drag → mouseup 가 자기 column --cols px 만 증가시키고 인접은 불변", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
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

  it("read-only path 는 localStorage 에 widths 를 저장하지 않는다", () => {
    window.localStorage.clear();
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
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
        new MouseEvent("mousemove", { bubbles: true, clientX: 220 }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 220 }),
      );
    });

    // column-widths: prefix 로 저장된 키가 없어야 한다.
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      expect(key?.startsWith("column-widths:")).toBe(false);
    }
  });
});
