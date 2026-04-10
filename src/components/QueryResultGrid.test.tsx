import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import QueryResultGrid from "./QueryResultGrid";
import type { QueryResult } from "../types/query";

const SELECT_RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer" },
    { name: "name", data_type: "text" },
  ],
  rows: [
    [1, "Alice"],
    [2, null],
  ],
  total_count: 2,
  execution_time_ms: 15,
  query_type: "select",
};

const DML_RESULT: QueryResult = {
  columns: [],
  rows: [],
  total_count: 5,
  execution_time_ms: 8,
  query_type: { dml: { rows_affected: 5 } },
};

const DDL_RESULT: QueryResult = {
  columns: [],
  rows: [],
  total_count: 0,
  execution_time_ms: 120,
  query_type: "ddl",
};

describe("QueryResultGrid", () => {
  it("shows idle prompt when status is idle", () => {
    render(<QueryResultGrid queryState={{ status: "idle" }} />);
    expect(screen.getByText(/Cmd\+Return/i)).toBeInTheDocument();
  });

  it("shows spinner when status is running", () => {
    render(
      <QueryResultGrid queryState={{ status: "running", queryId: "q1" }} />,
    );
    expect(screen.getByText("Executing query...")).toBeInTheDocument();
    expect(document.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows error message when status is error", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "error", error: "Connection lost" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Connection lost");
  });

  it("renders SELECT result with column headers and rows", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
    );
    // Column headers
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    // Data
    expect(screen.getByText("Alice")).toBeInTheDocument();
    // Row count
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    // Execution time
    expect(screen.getByText("15 ms")).toBeInTheDocument();
  });

  it("renders NULL values as italic text for SELECT", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: SELECT_RESULT }}
      />,
    );
    const nulls = screen.getAllByText("NULL");
    expect(nulls.length).toBeGreaterThan(0);
  });

  it("shows DML result with rows affected message", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DML_RESULT }}
      />,
    );
    expect(screen.getByText(/5 rows affected/)).toBeInTheDocument();
  });

  it("shows DDL result with success message", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DDL_RESULT }}
      />,
    );
    expect(
      screen.getByText("Query executed successfully"),
    ).toBeInTheDocument();
  });

  it("shows execution time for DDL", () => {
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: DDL_RESULT }}
      />,
    );
    expect(screen.getByText("120 ms")).toBeInTheDocument();
  });

  it("shows 'No data' for SELECT with empty rows", () => {
    const emptyResult: QueryResult = {
      ...SELECT_RESULT,
      rows: [],
      total_count: 0,
    };
    render(
      <QueryResultGrid
        queryState={{ status: "completed", result: emptyResult }}
      />,
    );
    expect(screen.getByText("No data")).toBeInTheDocument();
  });
});
