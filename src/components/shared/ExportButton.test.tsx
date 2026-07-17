import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportButton } from "./ExportButton";
import type { ExportContext } from "@/lib/tauri";
import { useToastStore } from "@/stores/toastStore";
import { setupTauriMock } from "@/test-utils/tauriMock";

// Sprint 181 — ExportButton dispatches into `@tauri-apps/plugin-dialog`
// (`save`) and `@tauri-apps/api/core` (`invoke`). Both are unavailable in
// jsdom, so we mock them at module level. Each test resets the mocks
// through `beforeEach` so the queue stays deterministic.
const mockSave = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (opts: unknown) => mockSave(opts),
}));

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args: unknown) => mockInvoke(cmd, args),
}));

function tableContext(): ExportContext {
  return { kind: "table", schema: "public", name: "users" };
}

function collectionContext(): ExportContext {
  return { kind: "collection", name: "events" };
}

function queryContext(): ExportContext {
  return { kind: "query", source_table: null };
}

const HEADERS = ["id", "name"];
const ROWS = [
  [1, "alice"],
  [2, "bob"],
];

// #1132 — ExportButton is a Radix DropdownMenu (menu keyboard model). Radix
// menus open on pointer/keyboard events, not a bare `click`, so drive them
// with userEvent which simulates the full pointer sequence.
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /export/i }));
}

beforeEach(() => {
  mockSave.mockReset();
  mockInvoke.mockReset();
  setupTauriMock({
    exportGridRows: (
      format: string,
      targetPath: string,
      headers: string[],
      rows: unknown[][],
      context: ExportContext,
      exportId: string | null = null,
    ) =>
      mockInvoke("export_grid_rows", {
        format,
        targetPath,
        headers,
        rows,
        context,
        exportId,
      }),
    cancelQuery: (queryId: string) => mockInvoke("cancel_query", { queryId }),
  });
  useToastStore.getState().clear();
});

describe("ExportButton", () => {
  // [AC-181-01a / #1638] RDB table surface lists CSV / TSV / SQL INSERT / JSON.
  // 2026-07-17 — #1638 opened tabular JSON export (headers-as-keys array of
  // objects), so JSON now appears on the table surface too.
  it("renders CSV / TSV / SQL / JSON menu items for table context", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await openMenu(user);
    expect(
      await screen.findByRole("menuitem", { name: /CSV/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /TSV/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /SQL INSERT/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /^JSON/i }),
    ).toBeInTheDocument();
  });

  // [#1638] Arbitrary SELECT (query) surface also exposes tabular JSON. Guards
  // that the query kind maps to the same JSON-enabled format list as table.
  it("renders a JSON menu item for query context", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton
        context={queryContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await openMenu(user);
    expect(
      await screen.findByRole("menuitem", { name: /^JSON/i }),
    ).toBeInTheDocument();
  });

  // [AC-181-01b] Mongo collection surface lists JSON / CSV / TSV.
  // 2026-05-01 — SQL is omitted because no SQL identifier context exists.
  it("renders JSON / CSV / TSV menu items for collection context", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton
        context={collectionContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await openMenu(user);
    expect(
      await screen.findByRole("menuitem", { name: /^JSON/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /CSV/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /TSV/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /SQL INSERT/i })).toBeNull();
  });

  // #1132 — the menu keyboard model: ArrowDown roving across items with a
  // single tab stop, Enter selects the highlighted format.
  it("supports ArrowDown roving + Enter selection (menu keyboard model)", async () => {
    const user = userEvent.setup();
    mockSave.mockResolvedValueOnce("/tmp/out.tsv");
    mockInvoke.mockResolvedValueOnce({ rows_written: 2, bytes_written: 30 });
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    // Open via keyboard so Radix auto-focuses the first item (CSV); ArrowDown
    // then rovs to the second (TSV) — the single-tab-stop menu model.
    screen.getByRole("button", { name: /export/i }).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: /CSV/i })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: /TSV/i })).toHaveFocus();
    await act(async () => {
      await user.keyboard("{Enter}");
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0]![1]).toMatchObject({ format: "tsv" });
  });

  // [AC-181-01c] disabledFormats marks SQL as aria-disabled with tooltip.
  // 2026-05-01 — Multi-table SELECT keeps the menu visible but blocks click.
  it("marks disabled formats as aria-disabled", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton
        context={queryContext()}
        headers={HEADERS}
        getRows={() => ROWS}
        disabledFormats={["sql"]}
      />,
    );
    await openMenu(user);
    const sqlItem = await screen.findByRole("menuitem", {
      name: /SQL INSERT/i,
    });
    expect(sqlItem).toHaveAttribute("aria-disabled", "true");
    expect(sqlItem.getAttribute("title")).toMatch(/single-table/i);
  });

  it("uses caller-provided disabled reasons for SQL export", async () => {
    const user = userEvent.setup();
    render(
      <ExportButton
        context={queryContext()}
        headers={HEADERS}
        getRows={() => ROWS}
        disabledFormats={["sql"]}
        disabledFormatReasons={{
          sql: "SQL INSERT export is disabled for DuckDB registered file sources.",
        }}
      />,
    );
    await openMenu(user);
    const sqlItem = await screen.findByRole("menuitem", {
      name: /SQL INSERT/i,
    });
    expect(sqlItem).toHaveAttribute("aria-disabled", "true");
    expect(sqlItem.getAttribute("title")).toMatch(/registered file sources/i);
  });

  it("can disable the whole export trigger with a reason", () => {
    render(
      <ExportButton
        context={queryContext()}
        headers={HEADERS}
        getRows={() => ROWS}
        disabled
        disabledReason="No displayed rows to export."
      />,
    );

    const trigger = screen.getByRole("button", { name: /export/i });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute("title", "No displayed rows to export.");
  });

  // [AC-181-02e] Save dialog cancel produces no toast.
  // 2026-05-01 — User-initiated cancel must stay silent.
  it("does not show a toast when the save dialog is cancelled", async () => {
    const user = userEvent.setup();
    mockSave.mockResolvedValueOnce(null);
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await openMenu(user);
    await act(async () => {
      await user.click(await screen.findByRole("menuitem", { name: /CSV/i }));
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // [AC-181-09a] Invoke reject surfaces a destructive (error) toast.
  // 2026-05-01 — IO failures must reach the user.
  it("surfaces a destructive toast when invoke rejects", async () => {
    const user = userEvent.setup();
    mockSave.mockResolvedValueOnce("/tmp/out.csv");
    mockInvoke.mockRejectedValueOnce(new Error("disk full"));
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await openMenu(user);
    await act(async () => {
      await user.click(await screen.findByRole("menuitem", { name: /CSV/i }));
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.variant).toBe("error");
    expect(toasts[0]?.message).toMatch(/disk full/);
  });

  // #1269 — while an export streams, the trigger becomes a Stop button that
  // fires the cooperative `cancelQuery` keyed by the export's own token id.
  it("shows a cancel button while exporting and fires cooperative cancel", async () => {
    const user = userEvent.setup();
    mockSave.mockResolvedValueOnce("/tmp/out.csv");
    let rejectExport: (reason: unknown) => void = () => {};
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "export_grid_rows") {
        return new Promise((_resolve, reject) => {
          rejectExport = reject;
        });
      }
      return Promise.resolve("cancelled");
    });
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: /CSV/i }));

    // The Stop affordance replaces the dropdown trigger mid-export.
    const cancelButton = await screen.findByTestId("export-cancel");
    await act(async () => {
      await user.click(cancelButton);
    });

    const cancelCall = mockInvoke.mock.calls.find(
      ([c]) => c === "cancel_query",
    );
    expect(cancelCall).toBeDefined();
    expect((cancelCall![1] as { queryId: string }).queryId).toMatch(/^export-/);

    // Backend aborts the write loop → cancel error. It must resolve as a
    // cancellation (info toast), never a destructive failure toast.
    await act(async () => {
      rejectExport(new Error("Export cancelled"));
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts.some((toast) => toast.variant === "error")).toBe(false);
    expect(toasts.some((toast) => toast.variant === "info")).toBe(true);
  });

  // [Invariant — Sprint 181] ExportButton's IPC payload never includes
  // password fields. 2026-05-01 — guards ADR-0005 plaintext password
  // boundary.
  it("never sends a password field in the invoke payload", async () => {
    const user = userEvent.setup();
    mockSave.mockResolvedValueOnce("/tmp/out.csv");
    mockInvoke.mockResolvedValueOnce({ rows_written: 2, bytes_written: 30 });
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await openMenu(user);
    await act(async () => {
      await user.click(await screen.findByRole("menuitem", { name: /CSV/i }));
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [, payload] = mockInvoke.mock.calls[0]!;
    expect(JSON.stringify(payload)).not.toMatch(/password/i);
  });
});
