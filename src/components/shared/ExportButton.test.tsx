import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ExportButton } from "./ExportButton";
import type { ExportContext } from "@/lib/tauri";
import { useToastStore } from "@/lib/toast";

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

beforeEach(() => {
  mockSave.mockReset();
  mockInvoke.mockReset();
  useToastStore.getState().clear();
});

describe("ExportButton", () => {
  // [AC-181-01a] RDB table surface lists CSV / TSV / SQL INSERT.
  // 2026-05-01 — JSON is omitted on RDB because BSON shape doesn't apply.
  it("renders CSV / TSV / SQL menu items for table context", async () => {
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(
      await screen.findByRole("menuitem", { name: /CSV/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /TSV/i })).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /SQL INSERT/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^JSON/i })).toBeNull();
  });

  // [AC-181-01b] Mongo collection surface lists JSON / CSV / TSV.
  // 2026-05-01 — SQL is omitted because no SQL identifier context exists.
  it("renders JSON / CSV / TSV menu items for collection context", async () => {
    render(
      <ExportButton
        context={collectionContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(
      await screen.findByRole("menuitem", { name: /^JSON/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /CSV/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /TSV/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /SQL INSERT/i })).toBeNull();
  });

  // [AC-181-01c] disabledFormats marks SQL as aria-disabled with tooltip.
  // 2026-05-01 — Multi-table SELECT keeps the menu visible but blocks click.
  it("marks disabled formats as aria-disabled", async () => {
    render(
      <ExportButton
        context={queryContext()}
        headers={HEADERS}
        getRows={() => ROWS}
        disabledFormats={["sql"]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    const sqlItem = await screen.findByRole("menuitem", {
      name: /SQL INSERT/i,
    });
    expect(sqlItem).toHaveAttribute("aria-disabled", "true");
    expect(sqlItem.getAttribute("title")).toMatch(/single-table/i);
  });

  // [AC-181-02e] Save dialog cancel produces no toast.
  // 2026-05-01 — User-initiated cancel must stay silent.
  it("does not show a toast when the save dialog is cancelled", async () => {
    mockSave.mockResolvedValueOnce(null);
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /export/i }));
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/i }));
    await act(async () => {
      // Allow the save promise to resolve.
    });
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // [AC-181-09a] Invoke reject surfaces a destructive (error) toast.
  // 2026-05-01 — IO failures must reach the user.
  it("surfaces a destructive toast when invoke rejects", async () => {
    mockSave.mockResolvedValueOnce("/tmp/out.csv");
    mockInvoke.mockRejectedValueOnce(new Error("disk full"));
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /export/i }));
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/i }));
    await act(async () => {});
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.variant).toBe("error");
    expect(toasts[0]?.message).toMatch(/disk full/);
  });

  // [Invariant — Sprint 181] ExportButton's IPC payload never includes
  // password fields. 2026-05-01 — guards ADR-0005 plaintext password
  // boundary.
  it("never sends a password field in the invoke payload", async () => {
    mockSave.mockResolvedValueOnce("/tmp/out.csv");
    mockInvoke.mockResolvedValueOnce({ rows_written: 2, bytes_written: 30 });
    render(
      <ExportButton
        context={tableContext()}
        headers={HEADERS}
        getRows={() => ROWS}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /export/i }));
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /CSV/i }));
    await act(async () => {});
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [, payload] = mockInvoke.mock.calls[0]!;
    expect(JSON.stringify(payload)).not.toMatch(/password/i);
  });
});
