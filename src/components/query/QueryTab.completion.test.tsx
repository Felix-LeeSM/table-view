// #2509 — `completion` axis. `QueryTab.toolbar.test.tsx`, which covers the
// toolbar Run button, `vi.mock`s `./SqlQueryEditor` into a DOM testbed, and
// that replacement is module-wide, so a real CodeMirror popup cannot open in
// that file. This axis therefore sits apart and mounts the real editor.

import { EditorView } from "@codemirror/view";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  expectCompletionPopupClosed,
  openCompletionPopup,
} from "./__tests__/editorCompletionHelpers";
import {
  MOCK_RESULT,
  makeQueryTab,
  mockAggregateDocuments,
  mockCancelQuery,
  mockExecuteQuery,
  mockFindDocuments,
  mockVerifyActiveDb,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";
import QueryTab from "./QueryTab";

beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
  });
});

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: (...args: unknown[]) => mockVerifyActiveDb(...args),
}));

vi.mock("./QueryResultGrid", () => ({
  default: () => <div data-testid="mock-result" />,
}));

// This axis does not use schema candidates. The popup comes from
// SqlQueryEditor's own `autocompletion()` plus the SQL language keyword
// source.
vi.mock("@hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
}));

function getEditorView(container: HTMLElement): EditorView {
  const cmEditor = container.querySelector(".cm-editor");
  if (!cmEditor) throw new Error(".cm-editor not found");
  const view = EditorView.findFromDOM(cmEditor as HTMLElement);
  if (!view) throw new Error("EditorView not found");
  return view;
}

describe("QueryTab — autocomplete popup on execute (#2509)", () => {
  beforeEach(() => {
    resetQueryTabStores();
    // If the run records history, the background write is rejected in jsdom
    // with no backend and stderr unrelated to the assertions piles up.
    useHistorySettingsStore.setState({ queryHistoryEnabled: false });
  });

  // User sequence: typing in the editor opens the autocomplete popup → the
  // mouse clicks the toolbar Run button → **the popup disappears and does not
  // cover the result grid** ← what this locks. The assertion is on the
  // absence of the popup element because spying on the close command being
  // called would stay green even if that command were changed to do nothing.
  //
  // This path carries the value because E2E clicks this button rather than
  // the shortcut (`runQuery` in `e2e/smoke/_helpers.ts` presses
  // `[aria-label="Run query"]`).
  it("closes the autocomplete popup when the toolbar Run button executes", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    const tab = makeQueryTab({ sql: "SEL" });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    const { container } = render(<QueryTab tab={tab} />);

    const view = getEditorView(container);
    await openCompletionPopup(view);

    await act(async () => {
      screen.getByLabelText("Run query").click();
    });
    // Confirms the click really reached the execute path — if the button did
    // nothing and the popup survived, this line should fail before the
    // assertion below.
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

    await expectCompletionPopupClosed(view);
  });
});
