// Sprint 187 (AC-187-06) — ConstraintsEditor strict / warn / confirm /
// cancel / stripe regressions. The flow mirrors IndexesEditor — drops are
// the dangerous path and surface as `ALTER TABLE … DROP CONSTRAINT …`,
// which the Sprint 187 analyzer extension flags as ddl-alter-drop /
// danger. Date: 2026-05-01.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ConstraintsEditor from "./ConstraintsEditor";
beforeEach(() => {
  setupTauriMock({
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
    // Sprint 247 — `<DryRunPreview>` IPC stub. See IndexesEditor.test.tsx.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

import * as tauri from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useSchemaStore } from "@stores/schemaStore";
import type { ConstraintInfo } from "@/types/schema";
import {
  SCHEMA_GRAPH_IMPACT_SESSION_FK,
  SCHEMA_GRAPH_IMPACT_USER_EMAIL_CONSTRAINT,
  seedSchemaGraphMigrationImpactFixture,
} from "@/test-utils/schemaGraphImpactFixture";

const SAMPLE_CONSTRAINT: ConstraintInfo = {
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
        dbType: "postgres",
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

async function renderEditorAndOpenPreview(constraint = SAMPLE_CONSTRAINT) {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <ConstraintsEditor
      connectionId="conn-1"
      database="db-1"
      table="users"
      schema="public"
      constraints={[constraint]}
      columns={[]}
      onColumnsChange={vi.fn()}
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: `Delete constraint ${constraint.name}`,
    }),
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
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      tableColumnsCache: {},
      tableIndexesCache: {},
      tableConstraintsCache: {},
    });
  });

  // AC-187-06a — production + strict + DROP CONSTRAINT preview opens
  // the confirm dialog (was block under Sprint 187/244). Sprint 245
  // (ADR 0022 Phase 1) — destructive-only policy uses the same dialog
  // for strict / warn / off on production. date 2026-05-01 / 2026-05-08.
  it("[AC-187-06a] production + strict + DROP CONSTRAINT → confirm dialog opens, dropConstraint deferred", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText("PRODUCTION DATABASE");
    const calls = vi.mocked(tauri.dropConstraint).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-06b — production + warn opens ConfirmDestructiveDialog instead
  // of committing. date 2026-05-01.
  it("[AC-187-06b] production + warn + DROP CONSTRAINT → ConfirmDestructiveDialog mount", async () => {
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
    await screen.findByText("PRODUCTION DATABASE");
    // Sprint 246 (ADR 0022 Phase 2) — Confirm is a simple Yes button;
    // the prior verbatim-typing gate was removed.
    act(() => {
      fireEvent.click(screen.getByTestId("confirm-destructive-confirm"));
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
    await screen.findByText("PRODUCTION DATABASE");
    // Sprint 246 — Cancel is reachable via stable testid; no DOM walk.
    act(() => {
      fireEvent.click(screen.getByTestId("confirm-destructive-cancel"));
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

  // AC-187-06e — non-production + warn environment commits without
  // gate. Sprint 245 — re-pinned to mode=warn to avoid the new M.1
  // strict-mode dialog (covered separately). date 2026-05-01 / 2026-05-08.
  it("[AC-187-06e] non-production environment commits without gate", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "dev-conn",
          dbType: "postgres",
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
    useSafeModeStore.setState({ mode: "warn" });
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

  it("shows cached SchemaGraph migration impact for constraint drops", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "dev-conn",
          dbType: "postgresql",
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
    seedSchemaGraphMigrationImpactFixture();
    await renderEditorAndOpenPreview({
      name: SCHEMA_GRAPH_IMPACT_USER_EMAIL_CONSTRAINT,
      constraint_type: "UNIQUE",
      columns: ["email"],
      reference_table: null,
      reference_columns: null,
    });

    expect(screen.getByText("Migration impact")).toBeInTheDocument();
    expect(
      screen.getByText(/public\.users\.users_email_key \(UNIQUE on email\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SCHEMA_GRAPH_IMPACT_SESSION_FK),
    ).toBeInTheDocument();
  });
});
