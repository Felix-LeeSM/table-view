import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSchemaStore } from "@stores/schemaStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  mockAddConstraint,
  mockCreateIndex,
  mockCreateTable,
  mockDropConstraint,
  renderDialog,
  setDevConnection,
  setProductionConnection,
} from "./__tests__/createTableDialogTestHelpers";
import {
  activateConstraintSubTab,
  addCheckRow,
  addFkRow,
  addUniqueRow,
  fillTwoColumnFormAndOpenForeignKeysTab,
  getColumnsPanel,
  getForeignKeysPanel,
  resetCreateTableDialogConstraintState,
} from "./__tests__/createTableDialogConstraintTestHelpers";

// ── Sprint 229 — Foreign Keys + CHECK + UNIQUE tab functional ─────────
//
// Date: 2026-05-07.
//
// Why this block exists:
//
// Sprint 228 left the Foreign Keys tab as a stale Sprint 229
// placeholder. Sprint 229 closes that loop: replace the placeholder with
// an interactive editor housing **three** constraint families on a
// single tab — Foreign Keys + CHECK + UNIQUE — sharing the same
// `tauri.addConstraint` chain target after the Sprint 228 createIndex
// chain. Atomic policy C — table+COMMENT in one transaction, indexes
// then constraints sequentially each in its own transaction; failures
// do NOT roll back earlier-applied work. The failing constraint name
// surfaces verbatim in the inline preview pane error slot.
//
// Path A backend extension landed: `ConstraintDefinition::ForeignKey`
// gains `on_delete` / `on_update` (`#[serde(default)]`), whitelist
// `{NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT}`.
//
// Source: `docs/sprints/sprint-229/contract.md` AC-229-01..AC-229-12.

describe("Sprint 229 — Constraint chain and cache contracts", () => {
  beforeEach(resetCreateTableDialogConstraintState);

  // ── AC-229-06 multi-statement preview shows full bundle ─────────

  it(
    "Show DDL bundles CREATE TABLE + 3× ADD CONSTRAINT (1 FK + 1 CHECK + 1 UNIQUE) (AC-229-06)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      mockAddConstraint.mockImplementation(
        async (req: {
          definition: { type: string };
          constraint_name: string;
        }) => ({
          sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
        }),
      );

      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "users", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                users: [
                  {
                    name: "id",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                ],
              },
            },
          },
        },
      });

      renderDialog({ availableSchemas: ["public"] });
      await fillTwoColumnFormAndOpenForeignKeysTab();

      addFkRow();
      await addCheckRow();
      await addUniqueRow();
      // Sprint 241 — sub-tabs hide inactive panels; each family's fields
      // are only reachable while its sub-tab is active. Re-activate
      // before manipulating each family's controls.
      await activateConstraintSubTab("Foreign Keys");
      const panel = getForeignKeysPanel();

      fireEvent.change(
        await within(panel).findByLabelText("Foreign key name"),
        {
          target: { value: "fk_orders_user" },
        },
      );
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "users" }));
      await waitFor(() => {
        expect(
          within(getForeignKeysPanel()).getByLabelText(
            "Foreign key reference column: id",
          ),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: id",
        ),
      );

      await activateConstraintSubTab("CHECK");
      fireEvent.change(
        await within(getForeignKeysPanel()).findByLabelText("Check name"),
        {
          target: { value: "chk_age" },
        },
      );
      fireEvent.change(
        within(getForeignKeysPanel()).getByLabelText("Check expression"),
        { target: { value: "age >= 0" } },
      );

      await activateConstraintSubTab("UNIQUE");
      fireEvent.change(
        await within(getForeignKeysPanel()).findByLabelText("Unique name"),
        {
          target: { value: "uq_orders_user" },
        },
      );
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText("Unique column: user_id"),
      );

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      // 2026-05-11 — intermediate debounce flushes (FK, FK+CHECK, FK+CHECK+UNIQUE)
      // fire during real-timer awaits, so exact call counts are non-deterministic
      // under heavy parallel pre-push load (rust-coverage 동시 실행 시 reproducible).
      // Assert on terminal state instead — every constraint name eventually shows
      // up in a preview call, matching the `018455a` fix applied at AC-229-08.
      await waitFor(() => {
        expect(mockCreateTable).toHaveBeenCalledWith(
          expect.objectContaining({ preview_only: true }),
        );
        for (const name of ["fk_orders_user", "chk_age", "uq_orders_user"]) {
          expect(mockAddConstraint).toHaveBeenCalledWith(
            expect.objectContaining({
              constraint_name: name,
              preview_only: true,
            }),
          );
        }
      });

      // 0 indexes declared → no createIndex calls.
      expect(mockCreateIndex).not.toHaveBeenCalled();

      // IPC sequence: createTable(true), then addConstraint(true) × 3.
      expect(
        (mockCreateTable.mock.calls[0]![0] as { preview_only: boolean })
          .preview_only,
      ).toBe(true);
      for (const c of mockAddConstraint.mock.calls) {
        expect((c[0] as { preview_only: boolean }).preview_only).toBe(true);
      }
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-07 chained Execute happy path ─────────────────────────

  it(
    "Execute chains createTable + addConstraint × 3 sequentially with one history entry (AC-229-07)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      let inflight = 0;
      let maxConcurrent = 0;
      mockAddConstraint.mockImplementation(
        async (req: {
          constraint_name: string;
          definition: { type: string };
        }) => {
          inflight += 1;
          if (inflight > maxConcurrent) maxConcurrent = inflight;
          await Promise.resolve();
          inflight -= 1;
          return {
            sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
          };
        },
      );

      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "users", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                users: [
                  {
                    name: "id",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                ],
              },
            },
          },
        },
      });

      const onRefresh = vi.fn().mockResolvedValue(undefined);
      const onClose = vi.fn();
      renderDialog({ onRefresh, onClose, availableSchemas: ["public"] });
      await fillTwoColumnFormAndOpenForeignKeysTab();

      addFkRow();
      let panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Foreign key name"), {
        target: { value: "fk_orders_user" },
      });
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "users" }));
      await waitFor(() => {
        expect(
          within(getForeignKeysPanel()).getByLabelText(
            "Foreign key reference column: id",
          ),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: id",
        ),
      );

      await addCheckRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Check name"), {
        target: { value: "chk_age" },
      });
      fireEvent.change(within(panel).getByLabelText("Check expression"), {
        target: { value: "age >= 0" },
      });

      await addUniqueRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Unique name"), {
        target: { value: "uq_orders_user" },
      });
      fireEvent.click(within(panel).getByLabelText("Unique column: user_id"));

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      // Intermediate debounce flushes are timing-sensitive under full-suite
      // coverage load, so assert the terminal preview state instead of exact
      // preview call counts.
      await waitFor(() => {
        expect(mockCreateTable).toHaveBeenCalledWith(
          expect.objectContaining({ preview_only: true }),
        );
        for (const name of ["fk_orders_user", "chk_age", "uq_orders_user"]) {
          expect(mockAddConstraint).toHaveBeenCalledWith(
            expect.objectContaining({
              constraint_name: name,
              preview_only: true,
            }),
          );
        }
      });

      fireEvent.click(screen.getByRole("button", { name: "Execute" }));
      await waitFor(() => {
        const createTableCommitCalls = mockCreateTable.mock.calls.filter(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        );
        const commitConstraints = mockAddConstraint.mock.calls.filter(
          (c) => (c[0] as { preview_only: boolean }).preview_only === false,
        );
        expect(createTableCommitCalls).toHaveLength(1);
        expect(commitConstraints).toHaveLength(3);
      });
      await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

      // Sequential — at most 1 in flight.
      expect(maxConcurrent).toBeLessThanOrEqual(1);

      // 1 history entry.
      const entries = useQueryHistoryStore.getState().recentVisible;
      expect(entries.filter((e) => e.source === "ddl-structure")).toHaveLength(
        1,
      );

      // Commit-only addConstraint × 3 (preview_only:false).
      const commitConstraints = mockAddConstraint.mock.calls.filter(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      );
      expect(commitConstraints).toHaveLength(3);
      expect(
        commitConstraints.map(
          (c) => (c[0] as { constraint_name: string }).constraint_name,
        ),
      ).toEqual(["fk_orders_user", "chk_age", "uq_orders_user"]);
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-08 constraint failure mid-chain ───────────────────────

  it(
    "2nd addConstraint(commit) rejection halts chain, modal stays open, error names failing constraint (AC-229-08)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      let commitConstraintCount = 0;
      mockAddConstraint.mockImplementation(
        async (req: {
          preview_only: boolean;
          constraint_name: string;
          definition: { type: string };
        }) => {
          if (req.preview_only) {
            return {
              sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
            };
          }
          commitConstraintCount += 1;
          if (commitConstraintCount === 2) {
            throw new Error('check constraint "chk_age" violated by some row');
          }
          return {
            sql: `ALTER TABLE "public"."orders" ADD CONSTRAINT "${req.constraint_name}" ${req.definition.type.toUpperCase()}`,
          };
        },
      );

      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "users", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                users: [
                  {
                    name: "id",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: true,
                    is_foreign_key: false,
                    fk_reference: null,
                    comment: null,
                  },
                ],
              },
            },
          },
        },
      });

      const onClose = vi.fn();
      renderDialog({ onClose, availableSchemas: ["public"] });
      await fillTwoColumnFormAndOpenForeignKeysTab();

      addFkRow();
      let panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Foreign key name"), {
        target: { value: "fk_orders_user" },
      });
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "users" }));
      await waitFor(() => {
        expect(
          within(getForeignKeysPanel()).getByLabelText(
            "Foreign key reference column: id",
          ),
        ).toBeInTheDocument();
      });
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: id",
        ),
      );

      await addCheckRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Check name"), {
        target: { value: "chk_age" },
      });
      fireEvent.change(within(panel).getByLabelText("Check expression"), {
        target: { value: "age >= 0" },
      });

      await addUniqueRow();
      panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Unique name"), {
        target: { value: "uq_orders_user" },
      });
      fireEvent.click(within(panel).getByLabelText("Unique column: user_id"));

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      // Intermediate debounce flushes (FK+CHECK, then FK+CHECK+UNIQUE) fire during real-timer
      // awaits, so exact call count is non-deterministic. Assert on content instead.
      await waitFor(() =>
        expect(mockAddConstraint).toHaveBeenCalledWith(
          expect.objectContaining({
            constraint_name: "uq_orders_user",
            preview_only: true,
          }),
        ),
      );

      fireEvent.click(screen.getByRole("button", { name: "Execute" }));

      await waitFor(() => {
        const previewPane = document.querySelector(
          "#create-table-ddl-preview",
        ) as HTMLElement;
        expect(previewPane.textContent).toContain("chk_age");
      });

      // Commit phase: only 2 addConstraint calls fired (1st succeeded,
      // 2nd rejected, 3rd never fires).
      const commitCalls = mockAddConstraint.mock.calls.filter(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      );
      expect(commitCalls).toHaveLength(2);
      expect(
        (commitCalls[0]![0] as { constraint_name: string }).constraint_name,
      ).toBe("fk_orders_user");
      expect(
        (commitCalls[1]![0] as { constraint_name: string }).constraint_name,
      ).toBe("chk_age");

      // CREATE TABLE was NOT rolled back. We assert the commit-side call
      // happened exactly once — preview-side call counts are debounce-
      // sensitive under heavy parallel load (same flake class fixed at
      // AC-229-08 in 018455a).
      const createTableCommitCalls = mockCreateTable.mock.calls.filter(
        (c) => (c[0] as { preview_only: boolean }).preview_only === false,
      );
      expect(createTableCommitCalls).toHaveLength(1);

      // Modal stays open + no rollback.
      expect(onClose).not.toHaveBeenCalled();
      expect(mockDropConstraint).not.toHaveBeenCalled();
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-09 reference table picker — schemaStore-cached + lazy load

  it("reference table picker populates from useSchemaStore.tables cache (AC-229-09)", async () => {
    useSchemaStore.setState({
      tables: {
        "conn-1": {
          "db-1": {
            public: [
              { name: "users", schema: "public", row_count: null },
              { name: "products", schema: "public", row_count: null },
            ],
          },
        },
      },
    });

    renderDialog({ availableSchemas: ["public"] });
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();

    const panel = getForeignKeysPanel();
    fireEvent.click(
      within(panel).getByRole("combobox", {
        name: "Foreign key reference table",
      }),
    );

    expect(
      await screen.findByRole("option", { name: "users" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "products" }),
    ).toBeInTheDocument();
  });

  it("reference schema selection triggers loadTables on cache miss (AC-229-09)", async () => {
    const loadTables = vi
      .fn<(connectionId: string, db: string, schema: string) => Promise<void>>()
      .mockResolvedValue(undefined);
    useSchemaStore.setState({
      tables: {},
      loadTables,
    });

    renderDialog({ availableSchemas: ["public", "analytics"] });
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();
    const panel = getForeignKeysPanel();

    // Switching ref schema (e.g. to analytics) must trigger the lazy
    // loadTables call when the cache is empty.
    fireEvent.click(
      within(panel).getByRole("combobox", {
        name: "Foreign key reference schema",
      }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "analytics" }));

    await waitFor(() => {
      expect(loadTables).toHaveBeenCalledWith("conn-1", "db-1", "analytics");
    });
  });

  // ── AC-229-10 0-constraint byte-equivalent regression ─────────────

  it("0-constraint IPC sequence is byte-equivalent to Sprint 228 (AC-229-10)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."events" ("id" integer)',
    });

    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "events" },
    });
    const columnsPanel = getColumnsPanel();
    fireEvent.change(within(columnsPanel).getByLabelText("Column name"), {
      target: { value: "id" },
    });
    fireEvent.change(within(columnsPanel).getByLabelText("Column data type"), {
      target: { value: "integer" },
    });

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Execute" }));
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(2));

    // No addConstraint and no createIndex calls when 0 constraints / 0
    // indexes declared.
    expect(mockAddConstraint).not.toHaveBeenCalled();
    expect(mockCreateIndex).not.toHaveBeenCalled();
  });

  // ── canonical Safe Mode warn-cancel verbatim survives bundle ────

  it(
    "Safe Mode warn-cancel surfaces the canonical message even with constraints declared (AC-229-12 / Sprint 228 invariant carry-over)",
    async () => {
      setProductionConnection();
      useSafeModeStore.setState({ mode: "warn" });
      mockCreateTable.mockResolvedValue({
        sql: 'DROP TABLE "public"."orders"',
      });
      mockAddConstraint.mockResolvedValue({
        sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "chk_x" CHECK (id > 0)',
      });

      renderDialog();
      await fillTwoColumnFormAndOpenForeignKeysTab();
      await addCheckRow();
      const panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Check name"), {
        target: { value: "chk_x" },
      });
      fireEvent.change(within(panel).getByLabelText("Check expression"), {
        target: { value: "id > 0" },
      });

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Execute" }));
      });
      await screen.findByText("PRODUCTION DATABASE");
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
        "Safe Mode (warn): confirmation cancelled — no changes committed",
      );
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );
});
