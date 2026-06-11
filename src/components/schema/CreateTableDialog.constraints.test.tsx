import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useSchemaStore } from "@stores/schemaStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import {
  PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  mockAddConstraint,
  mockCreateTable,
  renderDialog,
  setDevConnection,
  STALE_CONSTRAINTS_PLACEHOLDER,
} from "./__tests__/createTableDialogTestHelpers";
import {
  activateConstraintSubTab,
  activateTab,
  addCheckRow,
  addFkRow,
  addUniqueRow,
  fillTwoColumnFormAndOpenForeignKeysTab,
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

describe("Sprint 229 — Foreign Keys + CHECK + UNIQUE tab functional", () => {
  beforeEach(resetCreateTableDialogConstraintState);

  // ── AC-229-01: FK tab placeholder removed; 3 add-buttons present ─

  it("Foreign Keys tab no longer renders the stale Sprint 229 placeholder (AC-229-01)", async () => {
    renderDialog();
    activateTab("Constraints");
    const panel = getForeignKeysPanel();
    expect(panel.textContent).not.toContain(STALE_CONSTRAINTS_PLACEHOLDER);
    // Sprint 241 — FK is the default sub-tab; CHECK / UNIQUE add
    // buttons live behind their respective sub-tab triggers.
    expect(
      within(panel).getByRole("button", { name: /Add foreign key/i }),
    ).toBeInTheDocument();
    await activateConstraintSubTab("CHECK");
    expect(
      await within(panel).findByRole("button", { name: /Add check/i }),
    ).toBeInTheDocument();
    await activateConstraintSubTab("UNIQUE");
    expect(
      await within(panel).findByRole("button", { name: /Add unique/i }),
    ).toBeInTheDocument();
  });

  // ── AC-229-02: FK row inputs + ON DELETE / ON UPDATE 5-option list

  it("FK row renders all 7 inputs (name + local cols + ref schema + ref table + ref cols + ON DELETE + ON UPDATE) (AC-229-02)", async () => {
    renderDialog({ availableSchemas: ["public", "analytics"] });
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();
    const panel = getForeignKeysPanel();

    expect(
      within(panel).getByLabelText("Foreign key name"),
    ).toBeInTheDocument();
    // Local columns multi-checkbox group — labelled by column name.
    expect(
      within(panel).getByLabelText("Foreign key local column: order_id"),
    ).toBeInTheDocument();
    expect(
      within(panel).getByLabelText("Foreign key local column: user_id"),
    ).toBeInTheDocument();
    // Reference schema dropdown (combobox role from Radix Select trigger).
    expect(
      within(panel).getByRole("combobox", {
        name: "Foreign key reference schema",
      }),
    ).toBeInTheDocument();
    // Reference table dropdown OR free-text input (cache miss fallback).
    expect(
      within(panel).getByLabelText("Foreign key reference table"),
    ).toBeInTheDocument();
    // ON DELETE / ON UPDATE selectors.
    expect(
      within(panel).getByRole("combobox", { name: "Foreign key on delete" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("combobox", { name: "Foreign key on update" }),
    ).toBeInTheDocument();
    // Remove button.
    expect(
      within(panel).getByRole("button", { name: /Remove foreign key/i }),
    ).toBeInTheDocument();
  });

  it("ON DELETE / ON UPDATE dropdowns each list exactly 5 options (AC-229-02)", async () => {
    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    addFkRow();
    const panel = getForeignKeysPanel();
    fireEvent.click(
      within(panel).getByRole("combobox", { name: "Foreign key on delete" }),
    );
    const expected = [
      "NO ACTION",
      "RESTRICT",
      "CASCADE",
      "SET NULL",
      "SET DEFAULT",
    ];
    for (const v of expected) {
      expect(
        await screen.findByRole("option", { name: v }),
      ).toBeInTheDocument();
    }
  });

  // ── AC-229-03 Composite FK preview substring ────────────────────

  it(
    "composite FK emits FOREIGN KEY ('order_id','user_id') REFERENCES 'orders' ('id','line_no') in preview (AC-229-03)",
    async () => {
      setDevConnection();
      useSafeModeStore.setState({ mode: "off" });
      mockCreateTable.mockResolvedValue({
        sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
      });
      // Use the verbatim shape contract requires; backend will return
      // the substring that the test inspects.
      mockAddConstraint.mockResolvedValue({
        sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "fk_composite" FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")',
      });

      // Seed the schema store so the reference table picker can find
      // `orders` under public, with id+line_no as columns.
      useSchemaStore.setState({
        tables: {
          "conn-1": {
            "db-1": {
              public: [{ name: "orders", schema: "public", row_count: null }],
            },
          },
        },
        tableColumnsCache: {
          "conn-1": {
            "db-1": {
              public: {
                orders: [
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
                  {
                    name: "line_no",
                    data_type: "integer",
                    nullable: false,
                    default_value: null,
                    is_primary_key: false,
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

      const panel = getForeignKeysPanel();
      fireEvent.change(within(panel).getByLabelText("Foreign key name"), {
        target: { value: "fk_composite" },
      });
      // Pick local columns order_id + user_id.
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: order_id"),
      );
      fireEvent.click(
        within(panel).getByLabelText("Foreign key local column: user_id"),
      );

      // Reference schema = public (default), ref table = orders.
      fireEvent.click(
        within(panel).getByRole("combobox", {
          name: "Foreign key reference table",
        }),
      );
      fireEvent.click(await screen.findByRole("option", { name: "orders" }));

      // After ref table picked, ref columns checkbox group surfaces.
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
      fireEvent.click(
        within(getForeignKeysPanel()).getByLabelText(
          "Foreign key reference column: line_no",
        ),
      );

      // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
      await waitFor(() => expect(mockAddConstraint).toHaveBeenCalledTimes(1));
      const call = mockAddConstraint.mock.calls[0]![0] as {
        definition: {
          type: string;
          columns: string[];
          reference_table: string;
          reference_columns: string[];
        };
      };
      expect(call.definition.type).toBe("foreign_key");
      expect(call.definition.columns).toEqual(["order_id", "user_id"]);
      expect(call.definition.reference_table).toBe("orders");
      expect(call.definition.reference_columns).toEqual(["id", "line_no"]);

      const previewPane = document.querySelector(
        "#create-table-ddl-preview",
      ) as HTMLElement;
      expect(previewPane.textContent).toContain(
        'FOREIGN KEY ("order_id", "user_id") REFERENCES "orders" ("id", "line_no")',
      );
    },
    PRE_PUSH_LOAD_TEST_TIMEOUT_MS,
  );

  // ── AC-229-04 CHECK preview ───────────────────────────────────────

  it('CHECK row preview shows ADD CONSTRAINT "<name>" CHECK (<expression>) (AC-229-04)', async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
    });
    mockAddConstraint.mockResolvedValue({
      sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "chk_age" CHECK (age >= 0)',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    await addCheckRow();
    const panel = getForeignKeysPanel();
    fireEvent.change(within(panel).getByLabelText("Check name"), {
      target: { value: "chk_age" },
    });
    fireEvent.change(within(panel).getByLabelText("Check expression"), {
      target: { value: "age >= 0" },
    });

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockAddConstraint).toHaveBeenCalledTimes(1));
    const call = mockAddConstraint.mock.calls[0]![0] as {
      definition: { type: string; expression: string };
      constraint_name: string;
    };
    expect(call.definition.type).toBe("check");
    expect(call.definition.expression).toBe("age >= 0");
    expect(call.constraint_name).toBe("chk_age");

    const previewPane = document.querySelector(
      "#create-table-ddl-preview",
    ) as HTMLElement;
    expect(previewPane.textContent).toContain(
      'ADD CONSTRAINT "chk_age" CHECK (age >= 0)',
    );
  });

  it("whitespace-only CHECK expression is filtered out of the chain (AC-229-04)", async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."orders" ("order_id" integer)',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    await addCheckRow();
    const panel = getForeignKeysPanel();
    fireEvent.change(within(panel).getByLabelText("Check name"), {
      target: { value: "chk_blank" },
    });
    fireEvent.change(within(panel).getByLabelText("Check expression"), {
      target: { value: "   " },
    });

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockCreateTable).toHaveBeenCalledTimes(1));
    expect(mockAddConstraint).not.toHaveBeenCalled();
  });

  // ── AC-229-05 table-level UNIQUE ─────────────────────────────────

  it('table-level UNIQUE row preview shows ADD CONSTRAINT "<name>" UNIQUE ("col") (AC-229-05)', async () => {
    setDevConnection();
    useSafeModeStore.setState({ mode: "off" });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."orders" ("order_id" integer, "user_id" integer)',
    });
    mockAddConstraint.mockResolvedValue({
      sql: 'ALTER TABLE "public"."orders" ADD CONSTRAINT "uq_orders_user" UNIQUE ("user_id")',
    });

    renderDialog();
    await fillTwoColumnFormAndOpenForeignKeysTab();
    await addUniqueRow();
    const panel = getForeignKeysPanel();
    fireEvent.change(within(panel).getByLabelText("Unique name"), {
      target: { value: "uq_orders_user" },
    });
    fireEvent.click(within(panel).getByLabelText("Unique column: user_id"));

    // Sprint 239 — preview pane defaults open; auto-debounced fetch settles via waitFor below.
    await waitFor(() => expect(mockAddConstraint).toHaveBeenCalledTimes(1));
    const call = mockAddConstraint.mock.calls[0]![0] as {
      definition: { type: string; columns: string[] };
    };
    expect(call.definition.type).toBe("unique");
    expect(call.definition.columns).toEqual(["user_id"]);

    const previewPane = document.querySelector(
      "#create-table-ddl-preview",
    ) as HTMLElement;
    expect(previewPane.textContent).toContain(
      'ADD CONSTRAINT "uq_orders_user" UNIQUE ("user_id")',
    );
  });
});
