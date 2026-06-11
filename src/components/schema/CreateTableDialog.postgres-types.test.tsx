import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { invalidatePostgresTypesCache } from "@hooks/usePostgresTypes";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  getColumnsPanel,
  mockListPostgresTypes,
  renderDialog,
  setDevConnection,
} from "./__tests__/createTableDialogTestHelpers";

// ─────────────────────────────────────────────────────────────────────
// Sprint 230 — dynamic Postgres type list (Phase 27 sprint 5).
// AC-230-08 (dialog wires `usePostgresTypes` → `typesSource` prop) +
// AC-230-10 (loading-canonical-first + silent merge replacement).
// ─────────────────────────────────────────────────────────────────────

describe("Sprint 230 — CreateTableDialog wires dynamic PG type list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    // Punch the module memo so each Sprint 230 case sees a fresh
    // fetch sequence — `usePostgresTypes` shares one Promise per
    // connectionId across cases otherwise.
    invalidatePostgresTypesCache("conn-1");
    // Reset the default mock impl in case a prior case overrode it.
    mockListPostgresTypes.mockReset();
    mockListPostgresTypes.mockResolvedValue([]);
  });

  it("dialog mount calls tauri.listPostgresTypes(connectionId) exactly once (AC-230-08)", async () => {
    setDevConnection();
    mockListPostgresTypes.mockResolvedValueOnce([
      { schema: "public", name: "my_enum", type_kind: "enum" },
    ]);
    renderDialog();

    await waitFor(() => expect(mockListPostgresTypes).toHaveBeenCalledTimes(1));
    // Sprint 271a — wrapper now takes optional expectedDatabase as 2nd arg.
    // setProdConnection seeds connections[0].database = "app" → resolveActiveDb
    // falls back to the persisted database when no activeStatuses entry exists.
    expect(mockListPostgresTypes).toHaveBeenCalledWith("conn-1", "app");
  });

  it("dialog merges live types into the column-type combobox suggestions (AC-230-08)", async () => {
    setDevConnection();
    mockListPostgresTypes.mockResolvedValueOnce([
      { schema: "public", name: "my_enum", type_kind: "enum" },
      { schema: "extensions", name: "geometry", type_kind: "base" },
    ]);
    renderDialog();
    await waitFor(() => expect(mockListPostgresTypes).toHaveBeenCalledTimes(1));

    // Open the column-type combobox in the first row of the Columns
    // tab (active by default).
    const panel = getColumnsPanel();
    const typeInput = within(panel).getByRole("combobox", {
      name: "Column data type",
    });
    fireEvent.focus(typeInput);
    fireEvent.change(typeInput, { target: { value: "geo" } });

    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent ?? "",
    );
    expect(labels).toContain("extensions.geometry");
  });

  it("loading-canonical-first — combobox shows canonical entries instantly with no spinner (AC-230-10)", async () => {
    setDevConnection();
    // Defer the fetch resolution so we can assert the loading-state
    // surface (canonical visible, no spinner inside the combobox).
    let resolveFetch:
      | ((v: { schema: string; name: string; type_kind: string }[]) => void)
      | null = null;
    mockListPostgresTypes.mockImplementationOnce(
      () =>
        new Promise<{ schema: string; name: string; type_kind: string }[]>(
          (resolve) => {
            resolveFetch = resolve;
          },
        ),
    );
    renderDialog();

    const panel = getColumnsPanel();
    const typeInput = within(panel).getByRole("combobox", {
      name: "Column data type",
    });
    fireEvent.focus(typeInput);
    // Canonical entries (e.g. `varchar`) MUST be visible in the
    // listbox immediately — no spinner / no skeleton inside the
    // combobox subtree.
    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent ?? "",
    );
    expect(labels).toContain("varchar");
    expect(labels).toContain("uuid");
    // No spinner element inside the combobox subtree.
    expect(
      within(typeInput.parentElement as HTMLElement).queryByRole("status"),
    ).toBeNull();

    // Clean up — resolve the deferred Promise so the hook unmounts
    // gracefully.
    await act(async () => {
      resolveFetch?.([]);
    });
  });
});
