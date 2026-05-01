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
  // Click the inline trash icon to register a DROP COLUMN change.
  fireEvent.click(screen.getByRole("button", { name: /Delete column email/i }));
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

describe("ColumnsEditor — Sprint 187 Safe Mode gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "strict" });
  });

  // AC-187-04a — production + strict + DROP COLUMN preview blocks Execute
  // with the standard strict message. The gate splits the previewSql on
  // `;` so an ALTER batch with any DROP COLUMN inside trips strict.
  // date 2026-05-01.
  it("[AC-187-04a] production + strict + DROP COLUMN → execute blocked", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText(/Safe Mode blocked: ALTER TABLE DROP COLUMN/);
    // The danger DDL must NOT have been committed.
    const calls = vi.mocked(tauri.alterTable).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-04b — production + warn + DROP COLUMN opens the type-to-confirm
  // dialog instead of committing. alterTable must not be invoked with
  // preview_only=false until the user types the analyzer reason.
  // date 2026-05-01.
  it("[AC-187-04b] production + warn + DROP COLUMN → ConfirmDangerousDialog mount", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText("Confirm dangerous statement");
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

  // AC-187-04c — confirm flow: typing the reason verbatim enables the
  // destructive button; clicking it invokes alterTable with preview_only=
  // false. date 2026-05-01.
  it("[AC-187-04c] confirmDangerous → alterTable called with preview_only=false", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });
    await screen.findByText("Confirm dangerous statement");
    const input = screen.getByTestId("confirm-dangerous-input");
    fireEvent.change(input, { target: { value: "ALTER TABLE DROP COLUMN" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Run anyway/i }));
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
  // date 2026-05-01.
  it("[AC-187-04d] cancelDangerous → previewError set with warn message", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });
    await screen.findByText("Confirm dangerous statement");
    // The warn dialog renders its own Cancel — scope to the AlertDialog
    // content so we don't grab the SQL preview footer Cancel.
    const alertDialog = document.querySelector(
      '[data-slot="alert-dialog-content"]',
    ) as HTMLElement;
    const cancelBtn = Array.from(alertDialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    );
    act(() => {
      cancelBtn?.click();
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
  // ADD COLUMN is safe-classified anyway, so the Execute click should
  // commit immediately. date 2026-05-01.
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
});
