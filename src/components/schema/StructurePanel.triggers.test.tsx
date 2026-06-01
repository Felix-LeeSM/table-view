// Sprint 272 (2026-05-13) — StructurePanel Triggers tab covers the
// read-only Triggers sub-tab landing in Phase 26 Slice 1. Asserts:
//   - Tab list extended with "Triggers" after Constraints.
//   - `initialSubTab="triggers"` mounts directly on the Triggers tab
//     (the right-click "View Triggers" affordance threads this value
//     through `tab.initialStructureSubTab` → `StructurePanel.initialSubTab`).
//   - `getTableTriggers` IPC is invoked once per (connId, db, schema,
//     table); `hasFetchedTriggers` gate prevents an "No triggers" flash
//     before the first fetch resolves.
//   - Trigger card surfaces `pg_get_triggerdef` definition in a
//     monospace `<pre>` block plus structured metadata (timing / events
//     / orientation / function reference / WHEN clause).
//   - Empty trigger list renders the italic "No triggers" placeholder.
//
// Sprint 275 (2026-05-13) — sidebar Triggers child group retired;
// trigger CRUD now lives on this surface. New cases below assert:
//   - `+ Create Trigger` button mounts the `CreateTriggerDialog`.
//   - Per-trigger row carries a trash icon (aria-label "Drop trigger
//     {name}") that mounts the `DropTriggerDialog`.
//   - After Create / Drop, `refreshTableTriggers` is invoked so the
//     schemaStore cache + the panel list both refresh.
//   - Closing each dialog clears its local state slot.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, act, fireEvent } from "@testing-library/react";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import {
  MOCK_TRIGGERS,
  mockGetTableTriggers,
  renderPanel,
  resetStructurePanelMocks,
} from "./__tests__/structurePanelTestHelpers";

// Sprint 275 — `refreshTableTriggers` is the store action invoked by
// the StructurePanel CRUD post-commit `onRefresh` callbacks. Stubbed so
// the tests can assert "the cache was invalidated".
const mockRefreshTableTriggers = vi.fn().mockResolvedValue(MOCK_TRIGGERS);

describe("StructurePanel Triggers tab (Sprint 272)", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
    // Sprint 275 — wire the refresh action onto the store mock so the
    // post-commit `onRefresh` paths from Create/Drop can be observed.
    mockRefreshTableTriggers.mockClear();
    mockRefreshTableTriggers.mockResolvedValue(MOCK_TRIGGERS);
    useConnectionStore.setState({ connections: [] });
    useSchemaStore.setState({
      refreshTableTriggers: mockRefreshTableTriggers,
    } as Partial<Parameters<typeof useSchemaStore.setState>[0]>);
  });

  it("exposes the Triggers tab after Constraints", async () => {
    await act(async () => {
      renderPanel();
    });
    const triggersTab = screen.getByRole("tab", { name: "Triggers" });
    expect(triggersTab).toBeInTheDocument();
  });

  it("mounts on Triggers when initialSubTab='triggers'", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    expect(mockGetTableTriggers).toHaveBeenCalledWith(
      "conn-1",
      "db-1",
      "users",
      "public",
    );
    expect(mockGetTableTriggers).toHaveBeenCalledTimes(1);
  });

  it("renders trigger metadata + pg_get_triggerdef source in a monospace pre block", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });

    const fixture = MOCK_TRIGGERS[0]!;
    // Name appears in the card header.
    expect(screen.getByText(fixture.name)).toBeInTheDocument();
    // Timing + events summary — "BEFORE INSERT OR UPDATE · FOR EACH ROW".
    expect(
      screen.getByText(/BEFORE INSERT OR UPDATE · FOR EACH ROW/),
    ).toBeInTheDocument();
    // Function reference rendered as `schema.name(args)`. The
    // `definition` <pre> also contains the substring, so the structured
    // metadata cell needs to be addressed via `getAllByText` (>= 2 hits).
    expect(
      screen.getAllByText(/audit\.log_change\('users'\)/).length,
    ).toBeGreaterThanOrEqual(1);
    // WHEN clause rendered when present (same multi-hit consideration).
    expect(
      screen.getAllByText(/\(NEW\.email IS NOT NULL\)/).length,
    ).toBeGreaterThanOrEqual(1);
    // Definition pre block — testid keyed by trigger name so multi-
    // trigger fixtures can each be addressed individually.
    const pre = screen.getByTestId(`trigger-source-${fixture.name}`);
    expect(pre.tagName).toBe("PRE");
    expect(pre.textContent).toContain("CREATE TRIGGER audit_users_insert");
  });

  it("renders 'No triggers' placeholder when the fixture is empty", async () => {
    mockGetTableTriggers.mockResolvedValueOnce([]);
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    expect(screen.getByText("No triggers")).toBeInTheDocument();
  });

  it("hasFetchedTriggers gate prevents 'No triggers' flash before first fetch resolves", async () => {
    // Returning a never-resolving promise simulates the first paint
    // before the fetch settles. The empty-state placeholder must NOT
    // render until the promise resolves (mirrors the `hasFetchedColumns`
    // gate pattern). Use a manually-controlled deferred so the test can
    // assert "still hidden" before resolving.
    let resolveTriggers: ((v: typeof MOCK_TRIGGERS) => void) | null = null;
    mockGetTableTriggers.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTriggers = resolve;
      }),
    );
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    // Fetch is in-flight; the "No triggers" placeholder MUST NOT show.
    expect(screen.queryByText("No triggers")).not.toBeInTheDocument();
    // Resolve the fetch with an empty list — now the placeholder appears.
    await act(async () => {
      resolveTriggers!([]);
    });
    expect(screen.getByText("No triggers")).toBeInTheDocument();
  });

  it("re-fetches on the refresh-structure event", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    expect(mockGetTableTriggers).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("refresh-structure"));
    });
    expect(mockGetTableTriggers).toHaveBeenCalledTimes(2);
  });

  it("clicking the Triggers tab swaps the active panel", async () => {
    await act(async () => {
      renderPanel();
    });
    // Default mounts on Columns; the Triggers card is not present yet.
    expect(
      screen.queryByTestId(`trigger-source-${MOCK_TRIGGERS[0]!.name}`),
    ).not.toBeInTheDocument();
    // Radix `TabsTrigger` activates on `mouseDown` (not `click`) — see
    // existing StructurePanel.constraints.test.tsx tab-switch pattern.
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Triggers" }));
    });
    expect(
      await screen.findByTestId(`trigger-source-${MOCK_TRIGGERS[0]!.name}`),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------
  // Sprint 275 (2026-05-13) — Trigger CRUD consolidated onto this tab.
  // -------------------------------------------------------------------

  it("exposes a +Create Trigger button on the Triggers toolbar with aria-label", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    const createBtn = screen.getByRole("button", { name: "Create trigger" });
    expect(createBtn).toBeInTheDocument();
  });

  it("clicking +Create Trigger mounts CreateTriggerDialog with the table/schema context", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    // Dialog is not mounted before the click — the title is unique to it.
    expect(
      screen.queryByRole("heading", { name: "Create Trigger" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create trigger" }));
    });
    // CreateTriggerDialog rendered with `schemaName.tableName` in the
    // description — `public.users` per the fixture.
    expect(
      screen.getByRole("heading", { name: "Create Trigger" }),
    ).toBeInTheDocument();
    expect(screen.getByText("public.users")).toBeInTheDocument();
  });

  it("renders a per-trigger trash icon with aria-label 'Drop trigger {name}'", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    const fixture = MOCK_TRIGGERS[0]!;
    const dropBtn = screen.getByRole("button", {
      name: `Drop trigger ${fixture.name}`,
    });
    expect(dropBtn).toBeInTheDocument();
  });

  it("clicking the trash icon mounts DropTriggerDialog with the trigger/schema/table props", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    const fixture = MOCK_TRIGGERS[0]!;
    expect(
      screen.queryByRole("heading", { name: "Drop Trigger" }),
    ).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `Drop trigger ${fixture.name}` }),
      );
    });
    // DropTriggerDialog rendered with `{triggerName} on {schema}.{table}`.
    expect(
      screen.getByRole("heading", { name: "Drop Trigger" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`${fixture.name} on public.users`),
    ).toBeInTheDocument();
  });

  it("closing the CreateTriggerDialog clears the slot state", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create trigger" }));
    });
    expect(
      screen.getByRole("heading", { name: "Create Trigger" }),
    ).toBeInTheDocument();
    // Cancel button inside the dialog closes it.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(
      screen.queryByRole("heading", { name: "Create Trigger" }),
    ).not.toBeInTheDocument();
  });

  it("closing the DropTriggerDialog clears the slot state", async () => {
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    const fixture = MOCK_TRIGGERS[0]!;
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: `Drop trigger ${fixture.name}` }),
      );
    });
    expect(
      screen.getByRole("heading", { name: "Drop Trigger" }),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(
      screen.queryByRole("heading", { name: "Drop Trigger" }),
    ).not.toBeInTheDocument();
  });

  it("empty trigger list still surfaces the +Create Trigger button so the user can author their first trigger", async () => {
    mockGetTableTriggers.mockResolvedValueOnce([]);
    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });
    expect(screen.getByText("No triggers")).toBeInTheDocument();
    // Toolbar Create button must still be available in the empty state.
    expect(
      screen.getByRole("button", { name: "Create trigger" }),
    ).toBeInTheDocument();
  });

  it("[AC-445-02] MySQL trigger tab is read-only: metadata renders but structured create/drop controls stay hidden", async () => {
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "mysql",
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

    await act(async () => {
      renderPanel({ initialSubTab: "triggers" });
    });

    const fixture = MOCK_TRIGGERS[0]!;
    expect(
      screen.getByTestId(`trigger-source-${fixture.name}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create trigger" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: `Drop trigger ${fixture.name}` }),
    ).not.toBeInTheDocument();
  });
});
