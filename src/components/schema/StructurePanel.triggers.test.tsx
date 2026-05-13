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
// CREATE / DROP affordances are deliberately NOT exercised here — they
// land in Sprint 273 / 274.
import { describe, it, expect, beforeEach } from "vitest";
import { screen, act, fireEvent } from "@testing-library/react";
import {
  MOCK_TRIGGERS,
  mockGetTableTriggers,
  renderPanel,
  resetStructurePanelMocks,
} from "./__tests__/structurePanelTestHelpers";

describe("StructurePanel Triggers tab (Sprint 272)", () => {
  beforeEach(() => {
    resetStructurePanelMocks();
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
});
