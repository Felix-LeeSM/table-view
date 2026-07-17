import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ImportCsvDialog, { autoMapColumns, SKIP } from "./ImportCsvDialog";
import type { ColumnInfo } from "@/types/schema";

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (opts: unknown) => mockOpen(opts),
}));

const mockPreviewCsvImport = vi.fn();
const mockBuildCsvImportStatements = vi.fn();
vi.mock("@lib/tauri/import", () => ({
  previewCsvImport: (...args: unknown[]) => mockPreviewCsvImport(...args),
  buildCsvImportStatements: (...args: unknown[]) =>
    mockBuildCsvImportStatements(...args),
}));

const mockExecuteQueryBatch = vi.fn();
const mockCancelQuery = vi.fn();
vi.mock("@lib/tauri", () => ({
  executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
  cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
}));

const mockGetTableColumns = vi.fn();
vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (state: unknown) => unknown) =>
    selector({ getTableColumns: mockGetTableColumns }),
}));

function col(name: string, dataType = "text"): ColumnInfo {
  return {
    name,
    data_type: dataType,
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  };
}

function renderDialog(onClose = vi.fn()) {
  return render(
    <ImportCsvDialog
      connectionId="c1"
      database="db1"
      schemaName="public"
      tableName="people"
      onClose={onClose}
    />,
  );
}

// Purpose: #1639 preview + #1640 commit — the CSV import wizard previews +
// maps, then commits the mapping through build_csv_import_statements +
// executeQueryBatch (one atomic transaction). (2026-07-17)
describe("ImportCsvDialog", () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockPreviewCsvImport.mockReset();
    mockBuildCsvImportStatements.mockReset();
    mockExecuteQueryBatch.mockReset();
    mockCancelQuery.mockReset();
    mockGetTableColumns.mockReset();
    mockGetTableColumns.mockResolvedValue([
      col("id", "integer"),
      col("name"),
      col("extra"),
    ]);
  });

  it("previews the picked file and auto-maps columns by name", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/data/people.csv");
    mockPreviewCsvImport.mockResolvedValueOnce({
      headers: ["id", "name"],
      row_count: 2,
      preview_rows: [
        ["1", "ada"],
        ["2", "alan"],
      ],
    });

    renderDialog();
    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );

    expect(await screen.findByText("ada")).toBeInTheDocument();
    expect(screen.getByText("2 rows")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /csv header for column id/i }),
    ).toBeInTheDocument();
  });

  // #1653 review fix — the auto-map must survive the columns load resolving
  // AFTER the preview (a stale-capture race in Stage 1). The Import button (a
  // proxy for "mapping is populated") must become enabled once both resolve.
  it("auto-maps even when columns resolve after the preview (stale-race fix)", async () => {
    const user = userEvent.setup();
    let resolveColumns: (cols: ColumnInfo[]) => void = () => {};
    mockGetTableColumns.mockReturnValueOnce(
      new Promise<ColumnInfo[]>((resolve) => {
        resolveColumns = resolve;
      }),
    );
    mockOpen.mockResolvedValueOnce("/Users/felix/data/people.csv");
    mockPreviewCsvImport.mockResolvedValueOnce({
      headers: ["id", "name"],
      row_count: 1,
      preview_rows: [["1", "ada"]],
    });

    renderDialog();
    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );
    // Preview resolved first; columns are still pending, so nothing is mapped.
    await screen.findByText("1 rows");
    expect(screen.getByRole("button", { name: /^import$/i })).toBeDisabled();

    // Columns arrive late — the reactive auto-map must now populate the mapping.
    resolveColumns([col("id", "integer"), col("name")]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^import$/i })).toBeEnabled(),
    );
  });

  it("commits the mapping through build + executeQueryBatch after confirm", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/data/people.csv");
    mockPreviewCsvImport.mockResolvedValueOnce({
      headers: ["id", "name"],
      row_count: 2,
      preview_rows: [
        ["1", "ada"],
        ["2", "alan"],
      ],
    });
    mockBuildCsvImportStatements.mockResolvedValueOnce([
      'INSERT INTO "public"."people" ("id", "name") VALUES (\'1\', \'ada\')',
      'INSERT INTO "public"."people" ("id", "name") VALUES (\'2\', \'alan\')',
    ]);
    mockExecuteQueryBatch.mockResolvedValueOnce([]);

    renderDialog();
    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );
    await screen.findByText("2 rows");

    // Import -> pre-commit confirmation naming target/rows/rollback policy.
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    const confirm = await screen.findByRole("region", {
      name: /import confirmation/i,
    });
    expect(within(confirm).getByText(/one transaction/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm import/i }));

    await waitFor(() =>
      expect(mockBuildCsvImportStatements).toHaveBeenCalledWith(
        "c1",
        "/Users/felix/data/people.csv",
        "public",
        "people",
        [
          { column: "id", sourceIndex: 0 },
          { column: "name", sourceIndex: 1 },
        ],
        { hasHeader: true, emptyAsNull: true },
      ),
    );
    // The whole import is one atomic executeQueryBatch call.
    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    const call = mockExecuteQueryBatch.mock.calls[0] ?? [];
    const [connId, statements, , expectedDb, safety] = call as unknown[];
    expect(connId).toBe("c1");
    expect(statements).toHaveLength(2);
    expect(expectedDb).toBe("db1");
    expect(safety).toBe(true);

    expect(await screen.findByText(/imported 2 rows/i)).toBeInTheDocument();
  });

  it("surfaces a commit failure as an alert without a success message", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/data/people.csv");
    mockPreviewCsvImport.mockResolvedValueOnce({
      headers: ["id", "name"],
      row_count: 1,
      preview_rows: [["1", "ada"]],
    });
    mockBuildCsvImportStatements.mockResolvedValueOnce([
      'INSERT INTO "public"."people" ("id", "name") VALUES (\'1\', \'ada\')',
    ]);
    mockExecuteQueryBatch.mockRejectedValueOnce(
      new Error("statement 1 of 1 failed: null value in column"),
    );

    renderDialog();
    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );
    await screen.findByText("1 rows");
    await user.click(screen.getByRole("button", { name: /^import$/i }));
    await user.click(screen.getByRole("button", { name: /confirm import/i }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(/statement 1 of 1 failed/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/imported .* rows/i)).toBeNull();
  });

  it("surfaces backend guard errors as an alert", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/data/secret.csv");
    mockPreviewCsvImport.mockRejectedValueOnce(
      new Error(
        "Local file path cannot target the internal app data directory",
      ),
    );

    renderDialog();
    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(/internal app data directory/i),
    ).toBeInTheDocument();
  });
});

// Purpose: #1639 — the pure auto-mapping helper (case-insensitive name match,
// else skip). Kept as a unit since it drives the wizard's default state. (2026-07-17)
describe("autoMapColumns", () => {
  it("maps by case-insensitive name and skips unmatched columns", () => {
    const mapping = autoMapColumns(
      [col("Id"), col("name"), col("missing")],
      ["id", "NAME", "other"],
    );
    expect(mapping).toEqual({ Id: "id", name: "NAME", missing: SKIP });
  });
});
