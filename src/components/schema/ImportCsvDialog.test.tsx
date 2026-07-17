import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ImportCsvDialog, { autoMapColumns, SKIP } from "./ImportCsvDialog";
import type { ColumnInfo } from "@/types/schema";

const mockOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (opts: unknown) => mockOpen(opts),
}));

const mockPreviewCsvImport = vi.fn();
vi.mock("@lib/tauri/import", () => ({
  previewCsvImport: (...args: unknown[]) => mockPreviewCsvImport(...args),
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

// Purpose: #1639 Stage 1 — read-only CSV import wizard: preview + column
// mapping, and (critically) NO commit/write affordance in this stage. (2026-07-17)
describe("ImportCsvDialog", () => {
  beforeEach(() => {
    mockOpen.mockReset();
    mockPreviewCsvImport.mockReset();
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

    render(
      <ImportCsvDialog
        connectionId="c1"
        database="db1"
        schemaName="public"
        tableName="people"
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );

    // Preview grid renders the parsed sample rows.
    expect(await screen.findByText("ada")).toBeInTheDocument();
    expect(screen.getByText("alan")).toBeInTheDocument();
    expect(screen.getByText("2 rows")).toBeInTheDocument();

    // The mapping wizard renders one labelled control per target column.
    // (auto-map *correctness* is pinned in the `autoMapColumns` unit test.)
    expect(
      screen.getByRole("combobox", { name: /csv header for column id/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /csv header for column extra/i }),
    ).toBeInTheDocument();
  });

  it("has no commit/write button (read-only Stage 1)", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/data/people.csv");
    mockPreviewCsvImport.mockResolvedValueOnce({
      headers: ["id"],
      row_count: 1,
      preview_rows: [["1"]],
    });

    render(
      <ImportCsvDialog
        connectionId="c1"
        database="db1"
        schemaName="public"
        tableName="people"
        onClose={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );
    await screen.findByText("1 rows");

    // The only footer action is Close — no Import/Commit/Save button exists.
    expect(
      screen.queryByRole("button", { name: /^(import|commit|save)$/i }),
    ).toBeNull();
    expect(
      screen.getByText(/import runs in a later step/i),
    ).toBeInTheDocument();
  });

  it("re-previews with hasHeader=false when the header toggle is cleared", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/data/people.csv");
    mockPreviewCsvImport
      .mockResolvedValueOnce({
        headers: ["id", "name"],
        row_count: 2,
        preview_rows: [["1", "ada"]],
      })
      .mockResolvedValueOnce({
        headers: ["Column 1", "Column 2"],
        row_count: 3,
        preview_rows: [["id", "name"]],
      });

    render(
      <ImportCsvDialog
        connectionId="c1"
        database="db1"
        schemaName="public"
        tableName="people"
        onClose={vi.fn()}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /choose a csv file/i }),
    );
    await screen.findByText("ada");

    await user.click(
      screen.getByRole("checkbox", {
        name: /treat the first row as a header/i,
      }),
    );

    expect(mockPreviewCsvImport).toHaveBeenLastCalledWith(
      "/Users/felix/data/people.csv",
      { hasHeader: false },
    );
    // "Column 1" appears in both the grid header and the mapping options, so
    // target the preview grid's column header specifically.
    expect(
      await screen.findByRole("columnheader", { name: "Column 1" }),
    ).toBeInTheDocument();
  });

  it("surfaces backend guard errors as an alert", async () => {
    const user = userEvent.setup();
    mockOpen.mockResolvedValueOnce("/Users/felix/data/secret.csv");
    mockPreviewCsvImport.mockRejectedValueOnce(
      new Error(
        "Local file path cannot target the internal app data directory",
      ),
    );

    render(
      <ImportCsvDialog
        connectionId="c1"
        database="db1"
        schemaName="public"
        tableName="people"
        onClose={vi.fn()}
      />,
    );
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
