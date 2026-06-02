import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import DuckdbFileAnalyticsDialog from "./DuckdbFileAnalyticsDialog";

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (opts: unknown) => mockOpen(opts),
}));

const mockRegisterFileAnalyticsSource = vi.fn();
const mockPreviewFileAnalyticsSource = vi.fn();
const mockExecuteFileAnalyticsQuery = vi.fn();
vi.mock("@lib/tauri/fileAnalytics", () => ({
  registerFileAnalyticsSource: (...args: unknown[]) =>
    mockRegisterFileAnalyticsSource(...args),
  previewFileAnalyticsSource: (...args: unknown[]) =>
    mockPreviewFileAnalyticsSource(...args),
  executeFileAnalyticsQuery: (...args: unknown[]) =>
    mockExecuteFileAnalyticsQuery(...args),
}));

const mockRecordHistoryEntry = vi.fn();
vi.mock("@lib/runtime/history/recordHistoryEntry", () => ({
  recordHistoryEntry: (...args: unknown[]) => mockRecordHistoryEntry(...args),
}));

const source = {
  id: "src-1",
  alias: "sales_csv",
  fileName: "sales.csv",
  kind: "csv" as const,
  sizeBytes: 42,
};

describe("DuckdbFileAnalyticsDialog", () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockRegisterFileAnalyticsSource.mockReset();
    mockPreviewFileAnalyticsSource.mockReset();
    mockExecuteFileAnalyticsQuery.mockReset();
    mockRecordHistoryEntry.mockReset();
  });

  it("registers a local source, runs source-scoped SQL, and keeps absolute paths off the dialog", async () => {
    const user = userEvent.setup();
    const absolutePath = "/Users/felix/private/sales.csv";
    mockOpen.mockResolvedValueOnce(absolutePath);
    mockRegisterFileAnalyticsSource.mockResolvedValueOnce(source);
    mockPreviewFileAnalyticsSource.mockResolvedValueOnce({
      source,
      executedSql: 'SELECT * FROM "sales_csv" LIMIT 100',
      result: {
        columns: [
          { name: "id", dataType: "integer", category: "number" },
          { name: "name", dataType: "text", category: "string" },
        ],
        rows: [
          [1, "Ada"],
          [2, "Bob"],
        ],
        totalCount: 2,
        executionTimeMs: 4,
        queryType: "select",
      },
    });
    mockExecuteFileAnalyticsQuery.mockResolvedValueOnce({
      source,
      executedSql: 'SELECT name AS selected_name FROM "sales_csv" WHERE id = 2',
      result: {
        columns: [
          { name: "selected_name", dataType: "text", category: "string" },
        ],
        rows: [["Bob"]],
        totalCount: 1,
        executionTimeMs: 3,
        queryType: "select",
      },
    });

    render(
      <DuckdbFileAnalyticsDialog connectionId="conn-1" onClose={vi.fn()} />,
    );

    await user.click(
      screen.getByRole("button", { name: /choose local file/i }),
    );

    expect(mockRegisterFileAnalyticsSource).toHaveBeenCalledWith(
      "conn-1",
      absolutePath,
    );
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("sales.csv")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(absolutePath);

    const sqlInput = await screen.findByRole("textbox", {
      name: /source sql/i,
    });
    expect(sqlInput).toHaveValue('SELECT * FROM "sales_csv" LIMIT 100');

    await user.clear(sqlInput);
    await user.type(
      sqlInput,
      'SELECT name AS selected_name FROM "sales_csv" WHERE id = 2',
    );
    await user.click(screen.getByRole("button", { name: /run source query/i }));

    expect(mockExecuteFileAnalyticsQuery).toHaveBeenCalledWith(
      "conn-1",
      "src-1",
      'SELECT name AS selected_name FROM "sales_csv" WHERE id = 2',
    );
    expect(mockRecordHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        connectionId: "conn-1",
        source: "file-analytics",
        paradigm: "rdb",
        queryMode: "sql",
        sql: 'SELECT name AS selected_name FROM "sales_csv" WHERE id = 2',
        status: "success",
        rowsAffected: 1,
      }),
    );

    const queryRegion = await screen.findByRole("region", {
      name: /query result/i,
    });
    expect(within(queryRegion).getByText("selected_name")).toBeInTheDocument();
    expect(within(queryRegion).getByText("Bob")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(absolutePath);
  });

  it("clears stale query results when a later source query fails", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/private/sales.csv");
    mockRegisterFileAnalyticsSource.mockResolvedValueOnce(source);
    mockPreviewFileAnalyticsSource.mockResolvedValueOnce({
      source,
      executedSql: 'SELECT * FROM "sales_csv" LIMIT 100',
      result: {
        columns: [{ name: "name", dataType: "text", category: "string" }],
        rows: [["Ada"]],
        totalCount: 1,
        executionTimeMs: 4,
        queryType: "select",
      },
    });
    mockExecuteFileAnalyticsQuery
      .mockResolvedValueOnce({
        source,
        executedSql: 'SELECT name FROM "sales_csv"',
        result: {
          columns: [{ name: "name", dataType: "text", category: "string" }],
          rows: [["Bob"]],
          totalCount: 1,
          executionTimeMs: 3,
          queryType: "select",
        },
      })
      .mockRejectedValueOnce(new Error("registered source alias is required"));

    render(
      <DuckdbFileAnalyticsDialog connectionId="conn-1" onClose={vi.fn()} />,
    );

    await user.click(
      screen.getByRole("button", { name: /choose local file/i }),
    );

    const sqlInput = await screen.findByRole("textbox", {
      name: /source sql/i,
    });
    await user.clear(sqlInput);
    await user.type(sqlInput, 'SELECT name FROM "sales_csv"');
    await user.click(screen.getByRole("button", { name: /run source query/i }));
    expect(
      within(
        await screen.findByRole("region", { name: /query result/i }),
      ).getByText("Bob"),
    ).toBeInTheDocument();

    await user.clear(sqlInput);
    await user.type(sqlInput, "SELECT 1");
    await user.click(screen.getByRole("button", { name: /run source query/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "registered source alias is required",
    );
    expect(
      screen.queryByRole("region", { name: /query result/i }),
    ).not.toBeInTheDocument();
  });
});
