// Sprint 187 (AC-187-05) — IndexesEditor strict / warn / confirm / cancel /
// stripe regressions for the structure-surface Safe Mode gate. The editor
// runs the gate inside `handlePreviewConfirm` (after the user has reviewed
// the SQL) because index drops surface their preview through a ref rather
// than a re-runnable buildAlterRequest. The drop path is the dangerous one;
// CREATE INDEX stays analyzer-safe. Date: 2026-05-01.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import IndexesEditor from "./IndexesEditor";
beforeEach(() => {
  setupTauriMock({
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
    // Sprint 247 — `<DryRunPreview>` mounts inside `<ConfirmDestructiveDialog>`
    // and calls `executeQueryDryRun`. Stub `[]` so the dialog assertions stay
    // unchanged; the dry-run lifecycle itself is covered in useDryRun.test.ts.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

import * as tauri from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  SCHEMA_GRAPH_IMPACT_SESSION_FK,
  SCHEMA_GRAPH_IMPACT_USER_EMAIL_INDEX,
  seedSchemaGraphMigrationImpactFixture,
} from "@/test-utils/schemaGraphImpactFixture";

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

async function renderEditorAndOpenPreview(index = SAMPLE_INDEX) {
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <IndexesEditor
      connectionId="conn-1"
      database="db-1"
      table="users"
      schema="public"
      indexes={[index]}
      columns={[]}
      onColumnsChange={vi.fn()}
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: `Delete index ${index.name}` }),
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
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      tableColumnsCache: {},
      tableIndexesCache: {},
      tableConstraintsCache: {},
    });
  });

  // AC-187-05a — production + strict + DROP INDEX preview opens the
  // confirm dialog (was block under Sprint 187/244). Sprint 245 (ADR
  // 0022 Phase 1) — destructive-only policy uses the same dialog for
  // strict / warn / off on production. date 2026-05-01 / 2026-05-08.
  it("[AC-187-05a] production + strict + DROP INDEX → confirm dialog opens, dropIndex deferred", async () => {
    setProductionConnection();
    useSafeModeStore.setState({ mode: "strict" });
    await renderEditorAndOpenPreview();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await screen.findByText("PRODUCTION DATABASE");
    // dropIndex with preview_only=false must NOT have been invoked yet
    // (only fires on confirm).
    const calls = vi.mocked(tauri.dropIndex).mock.calls;
    expect(
      calls.some(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      ),
    ).toBe(false);
  });

  // AC-187-05b — production + warn + DROP INDEX opens the warn dialog
  // instead of committing. date 2026-05-01.
  it("[AC-187-05b] production + warn + DROP INDEX → ConfirmDestructiveDialog mount", async () => {
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
    await screen.findByText("PRODUCTION DATABASE");
    // Sprint 246 (ADR 0022 Phase 2) — Confirm is a single Yes button;
    // type-to-confirm + Run anyway gate removed.
    const confirmBtn = screen.getByTestId("confirm-destructive-confirm");
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    act(() => {
      fireEvent.click(confirmBtn);
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
    await screen.findByText("PRODUCTION DATABASE");
    // Sprint 246 — Cancel via stable testid; no DOM walk.
    act(() => {
      fireEvent.click(screen.getByTestId("confirm-destructive-cancel"));
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

  // AC-187-05e — non-production + warn environment commits without
  // gate. Sprint 245 (ADR 0022 Phase 1) — re-pinned to mode=warn so it
  // still asserts "non-prod = unguarded" without overlapping the new
  // M.1 strict-mode dialog flow (covered separately by the per-paradigm
  // M.1 tests). date 2026-05-01 / 2026-05-08.
  it("[AC-187-05e] non-production environment commits without gate", async () => {
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
      const calls = vi.mocked(tauri.dropIndex).mock.calls;
      expect(
        calls.some(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        ),
      ).toBe(true);
    });
  });

  it("[AC-445-01] MySQL DROP INDEX preview and commit carry the parent table", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "mysql-dev",
          dbType: "mysql",
          host: "localhost",
          port: 3306,
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

    expect(vi.mocked(tauri.dropIndex).mock.calls[0]?.[0]).toMatchObject({
      schema: "public",
      table: "users",
      index_name: "idx_users_email",
      preview_only: true,
      expected_database: "db-1",
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /Execute/i }));
    });

    await waitFor(() => {
      expect(
        vi.mocked(tauri.dropIndex).mock.calls.some((c) => {
          const req = c[0] as { preview_only?: boolean; table?: string };
          return req.preview_only === false && req.table === "users";
        }),
      ).toBe(true);
    });
  });

  it("shows cached SchemaGraph migration impact for index drops", async () => {
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
      ...SAMPLE_INDEX,
      name: SCHEMA_GRAPH_IMPACT_USER_EMAIL_INDEX,
      is_unique: true,
    });

    expect(screen.getByText("Migration impact")).toBeInTheDocument();
    expect(
      screen.getByText(/public\.users\.users_email_idx \(email\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(SCHEMA_GRAPH_IMPACT_SESSION_FK),
    ).toBeInTheDocument();
  });
});

// #1618 (D2) — createIndex / dropObject must be gated SYMMETRICALLY: the earlier
// concern was that one action was verified while the other stayed live. Lock
// both gates so a regression that drops either flag is caught. Create Index
// reads `canCreateIndex`; the per-row drop-index trash reads `canDropObject`.
// (2026-07-17)
describe("IndexesEditor — #1618 D2 createIndex/dropObject symmetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
  });

  function renderEditor(props: {
    canCreateIndex?: boolean;
    canDropObject?: boolean;
  }) {
    render(
      <IndexesEditor
        connectionId="conn-1"
        database="db-1"
        table="users"
        schema="public"
        indexes={[SAMPLE_INDEX]}
        columns={[]}
        onColumnsChange={vi.fn()}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        {...props}
      />,
    );
  }

  // Reason: defaults keep both controls for gating-agnostic callers. (2026-07-17)
  it("shows Create Index + drop-index controls by default", () => {
    renderEditor({});
    expect(
      screen.getByRole("button", { name: "Create index" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Delete index ${SAMPLE_INDEX.name}`,
      }),
    ).toBeInTheDocument();
  });

  // Reason: createIndex false hides only Create; the drop control stays visible
  // when dropObject is still allowed (proves the gates are independent, not a
  // single coarse flag). (2026-07-17)
  it("hides only Create Index when canCreateIndex is false", () => {
    renderEditor({ canCreateIndex: false, canDropObject: true });
    expect(
      screen.queryByRole("button", { name: "Create index" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `Delete index ${SAMPLE_INDEX.name}`,
      }),
    ).toBeInTheDocument();
  });

  // Reason: dropObject false hides only the drop-index trash; Create stays.
  // (2026-07-17)
  it("hides only the drop-index control when canDropObject is false", () => {
    renderEditor({ canCreateIndex: true, canDropObject: false });
    expect(
      screen.getByRole("button", { name: "Create index" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: `Delete index ${SAMPLE_INDEX.name}`,
      }),
    ).not.toBeInTheDocument();
  });
});
