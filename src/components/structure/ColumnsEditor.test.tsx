// Reason: Sprint 179 (AC-179-02 / AC-179-03 / AC-179-04) — verifies
// ColumnsEditor's paradigm-aware copy in isolation. The structure-level
// tests already exercise the RDB default through StructurePanel.test.tsx;
// this sibling file keeps the dictionary-driven assertions close to the
// component they cover so the audit (labels-audit.md) can point here for
// the "Add Column"/"Add Field" + empty-state evidence. Date: 2026-04-30.
//
// Sprint 187 (AC-187-04) — extends this file with strict / warn / cancel /
// confirm regressions for the structure-surface Safe Mode gate. The
// `@lib/tauri` mock is hoisted so each test can stub `alterTable` to
// return the danger DDL we want the analyzer to flag. Date: 2026-05-01.
//
// Sprint 236 (AC-236-04 / AC-236-05) — `+ Column` toolbar button + per-row
// trash icon both REROUTED through `AddColumnDialog` / `DropColumnDialog`
// modals (no longer push pendingChanges). The inline-batched MODIFY path
// (Edit pencil → change → save → Review SQL → Execute) stays UNCHANGED,
// so the Sprint 187 Safe Mode gate regressions are migrated to drive
// the modify path instead of the trash path. Date: 2026-05-07.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ColumnsEditor from "./ColumnsEditor";

vi.mock("@lib/tauri", () => ({
  alterTable: vi.fn(() =>
    Promise.resolve({
      sql: "ALTER TABLE users DROP COLUMN email",
    }),
  ),
  // Sprint 236 — modal IPC wrappers are mocked so the dialogs mount
  // without exploding when ColumnsEditor renders them. The modal flow
  // itself is covered by `AddColumnDialog.test.tsx` /
  // `DropColumnDialog.test.tsx`.
  addColumnRequest: vi.fn(() => Promise.resolve({ sql: "" })),
  dropColumnRequest: vi.fn(() => Promise.resolve({ sql: "" })),
  listPostgresTypes: vi.fn(() => Promise.resolve([])),
  // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
  executeQueryDryRun: vi.fn(() => Promise.resolve([])),
  cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
}));

import * as tauri from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";

const SAMPLE_COLUMN = {
  name: "email",
  data_type: "text",
  nullable: true,
  default_value: null,
  is_primary_key: false,
  is_foreign_key: false,
  fk_reference: null,
  comment: null,
};

function setProductionConnection() {
  useConnectionStore.setState({
    connections: [
      {
        id: "conn-1",
        name: "prod-conn",
        db_type: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "u",
        password: null,
        environment: "production",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
  });
}

// Sprint 236 — drives the inline-batched MODIFY path (Edit pencil →
// change data_type → save) instead of the legacy inline-trash drop. The
// hoisted `alterTable` mock returns a DROP COLUMN preview so the Safe
// Mode analyzer still classifies the staged batch as danger (mirrors
// the original Sprint 187 fixture intent). The trash icon is now a
// modal opener and is NOT exercised here.
async function renderEditorAndOpenPreview(columns = [SAMPLE_COLUMN]) {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ColumnsEditor
      connectionId="conn-1"
      table="users"
      schema="public"
      columns={columns}
      onRefresh={onRefresh}
    />,
  );
  // Open inline edit on the first column.
  fireEvent.click(screen.getByRole("button", { name: /Edit column email/i }));
  // Change data_type so handleSave detects a real diff and pushes a
  // `modify` change to pendingChanges.
  fireEvent.change(screen.getByLabelText("Data type for email"), {
    target: { value: "varchar(255)" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Save changes for email/i }),
  );
  // Click Review SQL to populate the preview body.
  fireEvent.click(screen.getByRole("button", { name: /Review SQL \(1\)/i }));
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /Execute/i }),
    ).toBeInTheDocument();
  });
  return { ...view, onRefresh };
}

function renderEditor(
  props: {
    paradigm?: "rdb" | "document" | "search" | "kv" | undefined;
    columns?: never[];
  } = {},
) {
  // Empty columns + no pending changes triggers the empty-state branch
  // (`No columns found` / `No fields found`).
  return render(
    <ColumnsEditor
      connectionId="conn-1"
      table="users"
      schema="public"
      columns={props.columns ?? []}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
      paradigm={props.paradigm}
    />,
  );
}

describe("ColumnsEditor — paradigm-aware copy (Sprint 179)", () => {
  // Reason: AC-179-02b — paradigm="document" renders the Mongo button +
  // empty-state copy. The aria-label uses sentence case ("Add field") to
  // match the legacy ariaAddUnit pattern; visible text uses title case
  // ("Add Field") sourced from the dictionary. Date: 2026-04-30.
  it("[AC-179-02b] paradigm=\"document\" renders 'Add Field' button and 'No fields found' empty state", () => {
    renderEditor({ paradigm: "document" });

    // Visible button text — matches AC-179-02 user-visible mention.
    expect(screen.getByText("Add Field")).toBeInTheDocument();
    // Accessible name (aria-label sentence-case form).
    expect(
      screen.getByRole("button", { name: "Add field" }),
    ).toBeInTheDocument();
    // Empty-state copy.
    expect(screen.getByText("No fields found")).toBeInTheDocument();
  });

  // Reason: AC-179-02 negative assertion — under paradigm="document" the
  // RDB strings ("Add Column", "No columns found", and the lowercase
  // aria-label "Add column") are absent so users don't see the wrong
  // vocabulary. Date: 2026-04-30.
  it('[AC-179-02c] paradigm="document" hides RDB vocabulary', () => {
    renderEditor({ paradigm: "document" });

    expect(screen.queryByText("Add Column")).not.toBeInTheDocument();
    expect(screen.queryByText("No columns found")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add column" }),
    ).not.toBeInTheDocument();
  });

  // Reason: AC-179-03 — explicit paradigm="rdb" continues to render the
  // legacy RDB vocabulary (button "Add Column" + empty-state "No columns
  // found"). Date: 2026-04-30.
  it("[AC-179-03c] paradigm=\"rdb\" renders 'Add Column' + 'No columns found'", () => {
    renderEditor({ paradigm: "rdb" });

    expect(screen.getByText("Add Column")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No columns found")).toBeInTheDocument();
  });

  // Reason: AC-179-04b — paradigm prop missing/undefined falls back to
  // the RDB dictionary entry without throwing. Component-level fence on
  // top of the dictionary-level fence (paradigm-vocabulary.test.ts).
  // Date: 2026-04-30.
  it("[AC-179-04b] paradigm undefined falls back to RDB vocabulary", () => {
    renderEditor({ paradigm: undefined });

    expect(screen.getByText("Add Column")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add column" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No columns found")).toBeInTheDocument();
  });
});

describe("ColumnsEditor — Sprint 187 Safe Mode gate (inline MODIFY path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "strict" });
    // Reset the alterTable mock back to the danger-DDL fixture so each
    // test starts from the same Safe Mode classification baseline.
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE users DROP COLUMN email",
    });
  });

  // AC-187-04a — production + strict + danger-classified preview opens
  // the confirm dialog (was block under Sprint 187/244). Sprint 245
  // (ADR 0022 Phase 1) — destructive-only policy uses the same dialog
  // for strict / warn / off on production. date 2026-05-01 /
  // 2026-05-07 / 2026-05-08.
  it("[AC-187-04a] production + strict + danger preview → confirm dialog opens, alterTable deferred", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText("PRODUCTION DATABASE");
    // The danger DDL must NOT have been committed yet (only fires on
    // confirm).
    const calls = vi.mocked(tauri.alterTable).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-04b — production + warn + danger preview opens the
  // confirm dialog instead of committing. alterTable must not be
  // invoked with preview_only=false until the user clicks Confirm.
  // Sprint 236 migrated the trigger to the inline MODIFY path; Sprint
  // 246 (ADR 0022 Phase 2) replaced the type-to-confirm gate with the
  // simple Yes/No environment-aware dialog. date 2026-05-01 /
  // 2026-05-07 / 2026-05-08.
  it("[AC-187-04b] production + warn + danger preview → ConfirmDestructiveDialog mount", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText("PRODUCTION DATABASE");
    const alertDialog = document.querySelector(
      '[data-slot="alert-dialog-content"]',
    ) as HTMLElement;
    expect(alertDialog.textContent).toMatch(/ALTER TABLE DROP COLUMN/);
    const calls = vi.mocked(tauri.alterTable).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-04c — confirm flow: clicking the simple Confirm button
  // invokes alterTable with preview_only=false. Sprint 246 (ADR 0022
  // Phase 2) replaced the type-to-confirm + Run-anyway gate with a
  // single Yes button, so the test drives the destructive testid
  // directly. date 2026-05-01 / 2026-05-07 / 2026-05-08.
  it("[AC-187-04c] confirmDangerous → alterTable called with preview_only=false", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });
    await screen.findByText("PRODUCTION DATABASE");
    act(() => {
      fireEvent.click(screen.getByTestId("confirm-destructive-confirm"));
    });

    await waitFor(() => {
      const calls = vi.mocked(tauri.alterTable).mock.calls;
      expect(
        calls.some(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        ),
      ).toBe(true);
    });
  });

  // AC-187-04d — cancel flow: clicking Cancel inside the warn dialog
  // surfaces the standard warn message via the SQL preview error banner
  // (no toast — structure-surface dialog already shows inline errors).
  // Sprint 246 — Cancel button is reachable via the dialog's stable
  // testid; no need to query the AlertDialog DOM. date 2026-05-01 /
  // 2026-05-07 / 2026-05-08.
  it("[AC-187-04d] cancelDangerous → previewError set with warn message", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });
    await screen.findByText("PRODUCTION DATABASE");
    act(() => {
      fireEvent.click(screen.getByTestId("confirm-destructive-cancel"));
    });

    await screen.findByText(
      /Safe Mode \(warn\): confirmation cancelled — no changes committed/,
    );
    const calls = vi.mocked(tauri.alterTable).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-04e — non-production environment skips the gate entirely.
  // The MODIFY-flow click should commit immediately. date 2026-05-01 /
  // 2026-05-07.
  it("[AC-187-04e] non-production environment commits without gate", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "dev-conn",
          db_type: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "development",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
    useSafeModeStore.setState({ mode: "strict" });
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE users ADD COLUMN nickname text",
    });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await waitFor(() => {
      const calls = vi.mocked(tauri.alterTable).mock.calls;
      expect(
        calls.some(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        ),
      ).toBe(true);
    });
  });

  // AC-196-04-1 — Sprint 196 (FB-5b). Successful ALTER apply records a
  // queryHistoryStore entry tagged `source: "ddl-structure"`. We re-use
  // the development-environment scaffold so the Safe Mode gate stays in
  // permissive mode (development connection) and the apply flows directly
  // to runAlter without a confirm-dialog detour. 2026-05-02 / 2026-05-07.
  it("[AC-196-04-1] runAlter records a ddl-structure history entry on success", async () => {
    const { useQueryHistoryStore } = await import("@stores/queryHistoryStore");
    useQueryHistoryStore.setState({ entries: [], globalLog: [] });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "dev-conn",
          db_type: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "development",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
    useSafeModeStore.setState({ mode: "strict" });
    vi.mocked(tauri.alterTable).mockResolvedValue({
      sql: "ALTER TABLE users ADD COLUMN nickname text",
    });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await waitFor(() => {
      const entries = useQueryHistoryStore.getState().entries;
      expect(entries).toHaveLength(1);
      expect(entries[0]!.source).toBe("ddl-structure");
      expect(entries[0]!.status).toBe("success");
    });
  });
});

// Sprint 236 — `+ Column` toolbar button now opens `<AddColumnDialog>`
// (modal). The inline `NewColumnRow` path is removed. Trash icon now
// opens `<DropColumnDialog>`. These two tests pin the new mount
// contract; the dialog internals themselves are exercised by
// `AddColumnDialog.test.tsx` / `DropColumnDialog.test.tsx`. 2026-05-07.
describe("ColumnsEditor — Sprint 236 modal entrypoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "dev-conn",
          db_type: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "development",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
  });

  // AC-236-04 — `+ Column` opens AddColumnDialog (column name input
  // becomes visible). No inline NewColumnRow appears.
  it("[AC-236-04] + Column toolbar button opens AddColumnDialog", () => {
    render(
      <ColumnsEditor
        connectionId="conn-1"
        table="users"
        schema="public"
        columns={[SAMPLE_COLUMN]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(screen.getByLabelText("Column name")).toBeInTheDocument();
  });

  // AC-236-05 — Per-row trash icon opens DropColumnDialog (typing-
  // confirm input becomes visible). pendingChanges stays empty.
  it("[AC-236-05] trash icon opens DropColumnDialog instead of pushing pendingChanges", () => {
    render(
      <ColumnsEditor
        connectionId="conn-1"
        table="users"
        schema="public"
        columns={[SAMPLE_COLUMN]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Delete column email/i }),
    );
    expect(
      screen.getByLabelText("Type the column name to confirm"),
    ).toBeInTheDocument();
    // Review SQL pendingChanges counter must NOT appear (no pending
    // entries pushed by the trash click anymore).
    expect(
      screen.queryByRole("button", { name: /Review SQL/i }),
    ).not.toBeInTheDocument();
  });
});
