// Sprint 260 (2026-05-11) — AC-260-02: EditableQueryResultGrid drag-resize.
// Read-only QueryResultGrid 와 같은 메커니즘 — in-memory only (raw query 결과는
// 결정적인 stable identity 가 없어 persistenceKey 미사용).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, act } from "@testing-library/react";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";
beforeEach(() => {
  setupTauriMock({
    executeQuery: vi.fn(async () => ({})),
    executeQueryBatch: vi.fn(async () => []),
  });
});

const RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer", category: "int" },
    { name: "name", data_type: "text", category: "text" },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  total_count: 2,
  execution_time_ms: 1,
  query_type: "select",
};

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name"],
};

beforeEach(() => {
  // no-op.
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

describe("EditableQueryResultGrid — column resize (Sprint 260 AC-260-02)", () => {
  it("header 가 column 별 resize handle 을 노출", () => {
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    expect(getResizeHandles().length).toBe(2);
  });

  it("drag → mouseup 가 자기 column --cols px 만 증가시키고 인접은 불변", () => {
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
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

  it("editable path 는 localStorage 에 widths 를 저장하지 않는다", () => {
    window.localStorage.clear();
    render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
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
        new MouseEvent("mousemove", { bubbles: true, clientX: 240 }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 240 }),
      );
    });

    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      expect(key?.startsWith("column-widths:")).toBe(false);
    }
  });
});
