// Issue #1442 — SQL 탭 editable 결과 그리드 가상화 회귀 가드.
// QueryResultTable.virtualization.test.tsx / DataGridTable.virtualization.
// test.tsx 와 동형. jsdom viewport 패치 사유는 그쪽 헤더 참고.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen } from "@testing-library/react";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";

const VIEWPORT_HEIGHT = 600;

function makeResult(rowCount: number): QueryResult {
  return {
    columns: [
      { name: "id", dataType: "integer", category: "int" },
      { name: "name", dataType: "text", category: "text" },
    ],
    rows: Array.from({ length: rowCount }, (_, i) => [i, `name-${i}`]),
    totalCount: rowCount,
    executionTimeMs: 1,
    queryType: "select",
  };
}

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name"],
};

const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

describe("EditableQueryResultGrid virtualization (#1442)", () => {
  beforeEach(() => {
    setupTauriMock({
      executeQuery: vi.fn(async () => ({})),
      executeQueryBatch: vi.fn(async () => []),
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 800;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 800,
        bottom: VIEWPORT_HEIGHT,
        width: 800,
        height: VIEWPORT_HEIGHT,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("renders a bounded row window when rows exceed the threshold (1000)", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeLessThanOrEqual(101);
    expect(rows.length).toBeGreaterThan(1);
  });

  it("keeps aria-rowcount at 1 (header) + total rows while virtualized", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    expect(screen.getByRole("grid")).toHaveAttribute("aria-rowcount", "1001");
  });

  it("first virtual row carries aria-rowindex=2 (header is row 1)", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(1000)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows[0]).toHaveAttribute("aria-rowindex", "1");
    expect(rows[1]).toHaveAttribute("aria-rowindex", "2");
  });

  it("threshold boundary — exactly 200 rows renders every body row", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(200)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(201);
    expect(rows[200]).toHaveAttribute("aria-rowindex", "201");
  });

  it("threshold boundary — 201 rows enters the virtualized branch", () => {
    render(
      <EditableQueryResultGrid
        result={makeResult(201)}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
    const rows = screen.getAllByRole("row");
    expect(rows.length).toBeLessThan(202);
    expect(rows.length).toBeGreaterThan(1);
  });
});
