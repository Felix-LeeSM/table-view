// Sprint 187 (AC-187-05) — IndexesEditor strict / warn / confirm / cancel /
// stripe regressions for the structure-surface Safe Mode gate. The editor
// runs the gate inside `handlePreviewConfirm` (after the user has reviewed
// the SQL) because index drops surface their preview through a ref rather
// than a re-runnable buildAlterRequest. The drop path is the dangerous one;
// CREATE INDEX stays analyzer-safe. Date: 2026-05-01.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import IndexesEditor from "./IndexesEditor";

vi.mock("@lib/tauri", () => ({
  dropIndex: vi.fn(() =>
    Promise.resolve({
      sql: "DROP INDEX idx_users_email",
    }),
  ),
  createIndex: vi.fn(() =>
    Promise.resolve({
      sql: "CREATE INDEX idx_users_email ON users (email)",
    }),
  ),
}));

import * as tauri from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";

const SAMPLE_INDEX = {
  name: "idx_users_email",
  columns: ["email"],
  index_type: "btree",
  is_unique: false,
  is_primary: false,
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

async function renderEditorAndOpenPreview() {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <IndexesEditor
      connectionId="conn-1"
      table="users"
      schema="public"
      indexes={[SAMPLE_INDEX]}
      columns={[]}
      onColumnsChange={vi.fn()}
      onRefresh={onRefresh}
    />,
  );
  // Click the trash icon next to idx_users_email — populates previewSql
  // via the dropIndex mock and opens the preview dialog.
  fireEvent.click(
    screen.getByRole("button", { name: /Delete index idx_users_email/i }),
  );
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /Execute/i }),
    ).toBeInTheDocument();
  });
  return { ...view, onRefresh };
}

describe("IndexesEditor — Sprint 187 Safe Mode gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "strict" });
  });

  // AC-187-05a — production + strict + DROP INDEX preview blocks Execute
  // with the standard strict message. date 2026-05-01.
  it("[AC-187-05a] production + strict + DROP INDEX → execute blocked", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText(/Safe Mode blocked: DROP INDEX/);
    // dropIndex with preview_only=false must NOT have been invoked.
    const calls = vi.mocked(tauri.dropIndex).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-05b — production + warn + DROP INDEX opens the warn dialog
  // instead of committing. date 2026-05-01.
  it("[AC-187-05b] production + warn + DROP INDEX → ConfirmDangerousDialog mount", async () => {
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
    expect(alertDialog.textContent).toMatch(/DROP INDEX/);
    const calls = vi.mocked(tauri.dropIndex).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-05c — confirm flow: typing the analyzer reason ("DROP INDEX")
  // enables the destructive button; clicking it invokes dropIndex with
  // preview_only=false. date 2026-05-01.
  it("[AC-187-05c] confirmDangerous → dropIndex called with preview_only=false", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });
    await screen.findByText("Confirm dangerous statement");
    const input = screen.getByTestId("confirm-dangerous-input");
    fireEvent.change(input, { target: { value: "DROP INDEX" } });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Run anyway/i }));
    });

    await waitFor(() => {
      const calls = vi.mocked(tauri.dropIndex).mock.calls;
      expect(
        calls.some(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        ),
      ).toBe(true);
    });
  });

  // AC-187-05d — cancel flow: clicking Cancel inside the warn dialog sets
  // the standard warn previewError. date 2026-05-01.
  it("[AC-187-05d] cancelDangerous → previewError set with warn message", async () => {
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
    const cancelBtn = Array.from(alertDialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    );
    act(() => {
      cancelBtn?.click();
    });

    await screen.findByText(
      /Safe Mode \(warn\): confirmation cancelled — no changes committed/,
    );
    const calls = vi.mocked(tauri.dropIndex).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-05e — non-production environment skips the gate. date 2026-05-01.
  it("[AC-187-05e] non-production environment commits without gate", async () => {
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
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await waitFor(() => {
      const calls = vi.mocked(tauri.dropIndex).mock.calls;
      expect(
        calls.some(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        ),
      ).toBe(true);
    });
  });
});
