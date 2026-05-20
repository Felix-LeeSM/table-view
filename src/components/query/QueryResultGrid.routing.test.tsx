// Sprint 312 (Phase 28 Slice A6, 2026-05-14) — `QueryResultGrid` routing
// by `resultKind`.
//
// Test axes (4 cases):
//   1. undefined / "grid" → existing DataGrid (legacy invariant)
//   2. "scalar" + columns.count → ScalarOrListPanel mode="count"
//   3. "list" → ScalarOrListPanel mode="list"
//   4. "writeSummary" → WriteSummaryPanel (insert example)
//
// Plus: findOne(null) returning empty grid + resultKind:"scalar" → mode
// "findOne-empty" (renders "No matching document").

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen } from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "@/types/query";
import { useSchemaStore } from "@stores/schemaStore";
beforeEach(() => {
  setupTauriMock({
    getTableColumns: vi.fn(async () => []),
    executeQuery: vi.fn(async () => ({})),
  });
});

beforeEach(() => {
  useSchemaStore.setState({ tableColumnsCache: {} });
});

describe("QueryResultGrid — resultKind routing", () => {
  it("[AC-312-routing-01] undefined resultKind → DataGrid (legacy invariant)", () => {
    const result: QueryResult = {
      columns: [{ name: "id", data_type: "integer", category: "int" }],
      rows: [[1]],
      total_count: 1,
      execution_time_ms: 2,
      query_type: "select",
    };
    render(<QueryResultGrid queryState={{ status: "completed", result }} />);
    // Status-bar token from the legacy grid path.
    expect(screen.getByText(/SELECT/)).toBeInTheDocument();
    expect(screen.queryByText(/^Count$/)).toBeNull();
    expect(screen.queryByText(/No matching document/)).toBeNull();
  });

  it('[AC-312-routing-02] "scalar" with columns.count → ScalarOrListPanel count mode', () => {
    const result: QueryResult = {
      columns: [{ name: "count", data_type: "Int64", category: "int" }],
      rows: [[123]],
      total_count: 1,
      execution_time_ms: 1,
      query_type: "select",
      resultKind: "scalar",
    };
    render(<QueryResultGrid queryState={{ status: "completed", result }} />);
    expect(screen.getByText("123")).toBeInTheDocument();
    // Status bar token + label.
    expect(screen.getAllByText("Count").length).toBeGreaterThan(0);
  });

  it('[AC-312-routing-03] "list" → ScalarOrListPanel list mode', () => {
    const result: QueryResult = {
      columns: [{ name: "value", data_type: "string", category: "text" }],
      rows: [["a"], ["b"]],
      total_count: 2,
      execution_time_ms: 4,
      query_type: "select",
      resultKind: "list",
    };
    render(<QueryResultGrid queryState={{ status: "completed", result }} />);
    expect(screen.getByRole("heading", { name: "value" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it('[AC-312-routing-04] "writeSummary" → WriteSummaryPanel', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 7,
      query_type: "select",
      resultKind: "writeSummary",
      writeSummary: {
        kind: "insert",
        insertedIds: [{ ObjectId: "507f1f77bcf86cd799439011" }],
      },
    };
    render(<QueryResultGrid queryState={{ status: "completed", result }} />);
    expect(screen.getByText("Inserted 1 document")).toBeInTheDocument();
  });

  it('[AC-312-routing-05] "scalar" with empty columns → findOne-empty mode', () => {
    const result: QueryResult = {
      columns: [],
      rows: [],
      total_count: 0,
      execution_time_ms: 1,
      query_type: "select",
      resultKind: "scalar",
    };
    render(<QueryResultGrid queryState={{ status: "completed", result }} />);
    expect(screen.getByText("No matching document")).toBeInTheDocument();
  });
});
