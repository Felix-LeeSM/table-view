// Sprint 187 (AC-187-06) — ConstraintsEditor strict / warn / confirm /
// cancel / stripe regressions. The flow mirrors IndexesEditor — drops are
// the dangerous path and surface as `ALTER TABLE … DROP CONSTRAINT …`,
// which the Sprint 187 analyzer extension flags as ddl-alter-drop /
// danger. Date: 2026-05-01.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ConstraintsEditor from "./ConstraintsEditor";

vi.mock("@lib/tauri", () => ({
  dropConstraint: vi.fn(() =>
    Promise.resolve({
      sql: "ALTER TABLE users DROP CONSTRAINT fk_users_org",
    }),
  ),
  addConstraint: vi.fn(() =>
    Promise.resolve({
      sql: "ALTER TABLE users ADD CONSTRAINT u_users_email UNIQUE (email)",
    }),
  ),
}));

import * as tauri from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";

const SAMPLE_CONSTRAINT = {
  name: "fk_users_org",
  constraint_type: "FOREIGN KEY",
  columns: ["org_id"],
  reference_table: "orgs",
  reference_columns: ["id"],
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
    <ConstraintsEditor
      connectionId="conn-1"
      table="users"
      schema="public"
      constraints={[SAMPLE_CONSTRAINT]}
      columns={[]}
      onColumnsChange={vi.fn()}
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Delete constraint fk_users_org/i }),
  );
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: /Execute/i }),
    ).toBeInTheDocument();
  });
  return { ...view, onRefresh };
}

describe("ConstraintsEditor — Sprint 187 Safe Mode gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "strict" });
  });

  // AC-187-06a — production + strict + DROP CONSTRAINT preview blocks
  // Execute. date 2026-05-01.
  it("[AC-187-06a] production + strict + DROP CONSTRAINT → execute blocked", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText(/Safe Mode blocked: ALTER TABLE DROP CONSTRAINT/);
    const calls = vi.mocked(tauri.dropConstraint).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-06b — production + warn opens ConfirmDangerousDialog instead
  // of committing. date 2026-05-01.
  it("[AC-187-06b] production + warn + DROP CONSTRAINT → ConfirmDangerousDialog mount", async () => {
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
    expect(alertDialog.textContent).toMatch(/ALTER TABLE DROP CONSTRAINT/);
  });

  // AC-187-06c — confirm flow: typing the analyzer reason verbatim enables
  // the destructive button; click invokes dropConstraint with
  // preview_only=false. date 2026-05-01.
  it("[AC-187-06c] confirmDangerous → dropConstraint called with preview_only=false", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "warn" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });
    await screen.findByText("Confirm dangerous statement");
    const input = screen.getByTestId("confirm-dangerous-input");
    fireEvent.change(input, {
      target: { value: "ALTER TABLE DROP CONSTRAINT" },
    });
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Run anyway/i }));
    });

    await waitFor(() => {
      const calls = vi.mocked(tauri.dropConstraint).mock.calls;
      expect(
        calls.some(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        ),
      ).toBe(true);
    });
  });

  // AC-187-06d — cancel flow surfaces the standard warn message via
  // previewError. date 2026-05-01.
  it("[AC-187-06d] cancelDangerous → previewError set with warn message", async () => {
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
    const calls = vi.mocked(tauri.dropConstraint).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-06e — non-production environment skips the gate. date 2026-05-01.
  it("[AC-187-06e] non-production environment commits without gate", async () => {
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
      const calls = vi.mocked(tauri.dropConstraint).mock.calls;
      expect(
        calls.some(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        ),
      ).toBe(true);
    });
  });
});
