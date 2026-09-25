// MongoStructurePanel sub-sub-tab bar.
//
// Reason: guards AC-350-02 / 04 for the Mongo Structure pane's sub-sub-tab
// bar (Indexes / Validator) — (a) `role="tablist"` plus two `role="tab"`,
// (b) Indexes selected by default, (c) toggling by mouse click and by
// ArrowLeft/Right, (d) the inner selection survives re-activating the
// Structure tab (preserving the Validator panel's own state is out of
// scope, so the guard is that the component does not unmount),
// (e) the Validator sub-sub-tab mounts the `validator-panel` testid.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { MongoStructurePanel } from "../MongoStructurePanel";

const listMongoIndexesMock = vi.fn();
const getMongoValidatorMock = vi.fn();
const setMongoValidatorMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    listMongoIndexes: (...args: unknown[]) => listMongoIndexesMock(...args),
    getMongoValidator: (...args: unknown[]) => getMongoValidatorMock(...args),
    setMongoValidator: (...args: unknown[]) => setMongoValidatorMock(...args),
  });
});

describe("MongoStructurePanel (Sprint 350 — tracer Indexes/Validator shell)", () => {
  beforeEach(() => {
    listMongoIndexesMock.mockReset();
    listMongoIndexesMock.mockResolvedValue([]);
    getMongoValidatorMock.mockReset();
    getMongoValidatorMock.mockResolvedValue(null);
    setMongoValidatorMock.mockReset();
    cleanup();
  });

  it("renders a sub-sub-tab bar with Indexes selected by default", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        dbType="mongodb"
      />,
    );

    const tablist = screen.getByTestId("mongo-structure-subsubtab-bar");
    expect(tablist).toHaveAttribute("role", "tablist");

    const indexesTab = screen.getByRole("tab", { name: "Indexes" });
    const validatorTab = screen.getByRole("tab", { name: "Validator" });
    expect(indexesTab).toHaveAttribute("aria-selected", "true");
    expect(validatorTab).toHaveAttribute("aria-selected", "false");

    // Indexes panel mounted by default.
    expect(screen.getByTestId("mongo-indexes-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("validator-panel")).toBeNull();
  });

  it("switches to the Validator sub-sub-tab on click and mounts ValidatorPanel verbatim", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        dbType="mongodb"
      />,
    );

    const validatorTab = screen.getByRole("tab", { name: "Validator" });
    act(() => {
      fireEvent.click(validatorTab);
    });

    expect(validatorTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // Validator surface mounts via its existing testid.
    expect(screen.getByTestId("validator-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("mongo-indexes-panel")).toBeNull();
  });

  it("toggles selection via ArrowRight / ArrowLeft keyboard navigation", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        dbType="mongodb"
      />,
    );

    const indexesTab = screen.getByRole("tab", { name: "Indexes" });
    act(() => {
      fireEvent.keyDown(indexesTab, { key: "ArrowRight" });
    });
    expect(screen.getByRole("tab", { name: "Validator" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const validatorTab = screen.getByRole("tab", { name: "Validator" });
    act(() => {
      fireEvent.keyDown(validatorTab, { key: "ArrowLeft" });
    });
    expect(screen.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  // a11y: WAI-ARIA tabpanel wiring — Indexes/Validator tab ↔ panel link.
  it("wires each sub-sub-tab to its panel via aria-controls / aria-labelledby", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        dbType="mongodb"
      />,
    );

    // Indexes is active by default.
    const indexesTab = screen.getByRole("tab", { name: "Indexes" });
    const panel = screen.getByRole("tabpanel");
    expect(indexesTab).toHaveAttribute("id", "tab-mongo-structure-indexes");
    expect(panel).toHaveAttribute("aria-labelledby", indexesTab.id);
    expect(indexesTab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toContainElement(screen.getByTestId("mongo-indexes-panel"));

    // Switch to Validator — the mounted panel re-labels to the Validator tab.
    act(() => {
      fireEvent.click(screen.getByRole("tab", { name: "Validator" }));
    });
    const validatorTab = screen.getByRole("tab", { name: "Validator" });
    const validatorPanel = screen.getByRole("tabpanel");
    expect(validatorPanel).toHaveAttribute("aria-labelledby", validatorTab.id);
    expect(validatorTab).toHaveAttribute("aria-controls", validatorPanel.id);
  });

  // #1054 — U3 collection stats mount. The Stats sub-sub-tab is the
  // collection-context home for the previously-orphan CollectionStatsPanel
  // (needs (database, collection) so the connection-level Operations flyout
  // does not fit). Gate is the document paradigm — this panel only renders
  // inside the Mongo-only MongoStructurePanel.
  it("mounts CollectionStatsPanel on the Stats sub-sub-tab", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        dbType="mongodb"
      />,
    );

    const statsTab = screen.getByRole("tab", { name: "Stats" });
    expect(statsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.queryByTestId("collection-stats-panel")).toBeNull();

    act(() => {
      fireEvent.click(statsTab);
    });

    expect(statsTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("collection-stats-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("mongo-indexes-panel")).toBeNull();
    expect(screen.queryByTestId("validator-panel")).toBeNull();
  });

  // Issue #1718 (Stage 1, Part of #1717) — the Mongo Structure pane must
  // refetch its active sub-sub-panel when the global soft-refresh (Cmd+R)
  // broadcasts `refresh-structure`. The default Indexes panel force-reloads
  // its indexes; before this change the pane ignored refresh entirely.
  it("[#1718] refetches the Indexes panel on a refresh-structure event", async () => {
    __resetDocumentStoreForTests();
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        dbType="mongodb"
      />,
    );

    await waitFor(() => expect(listMongoIndexesMock).toHaveBeenCalled());
    const before = listMongoIndexesMock.mock.calls.length;

    act(() => {
      window.dispatchEvent(new CustomEvent("refresh-structure"));
    });

    await waitFor(() =>
      expect(listMongoIndexesMock.mock.calls.length).toBe(before + 1),
    );
  });

  it("manages roving tabindex so only the active tab is focusable", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
        dbType="mongodb"
      />,
    );

    expect(screen.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Validator" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
});
