// Issue #1141 (safety) + #1111 (ux decision) regression guards for the RDB
// DataGrid SQL preview dialog:
//  (a) Enter while focus is on Cancel must NOT execute the commit — the old
//      dialog-wide onKeyDown fired handleExecuteCommit from anywhere.
//  (b) the Execute button is disabled for a 150ms arm window after open, so a
//      reflexive Enter/click (right after Cmd+Enter) is absorbed.
//  (c) a second Enter/click while the first commit is in flight is a no-op.
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { SqlPreviewDialog } from "./SqlPreviewDialog";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";

type PreviewEditState = Pick<
  DataGridEditState,
  "sqlPreview" | "setSqlPreview" | "handleExecuteCommit" | "commitError"
>;

function makeEditState(
  overrides: Partial<PreviewEditState> = {},
): PreviewEditState {
  return {
    sqlPreview: ["DELETE FROM users"],
    setSqlPreview: vi.fn(),
    handleExecuteCommit: vi.fn().mockResolvedValue(undefined),
    commitError: null,
    ...overrides,
  };
}

function renderDialog(editState: PreviewEditState) {
  return render(
    <SqlPreviewDialog
      editState={editState}
      connectionEnvironment="production"
      connectionLabel="prod-db"
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SqlPreviewDialog — reflexive Enter / double-execution guards", () => {
  it("[#1141a] Enter while Cancel is focused does not execute the commit", async () => {
    const editState = makeEditState();
    const user = userEvent.setup();
    renderDialog(editState);

    const cancel = screen.getByRole("button", { name: /^cancel$/i });
    cancel.focus();
    await user.keyboard("{Enter}");

    expect(editState.handleExecuteCommit).not.toHaveBeenCalled();
    // Cancel still does its own job.
    expect(editState.setSqlPreview).toHaveBeenCalledWith(null);
  });

  it("[#1141b] Execute is disabled during the 150ms arm window then enabled", () => {
    vi.useFakeTimers();
    const editState = makeEditState();
    renderDialog(editState);

    const execute = screen.getByTestId("execute-button");
    expect(execute).toBeDisabled();
    fireEvent.click(execute);
    expect(editState.handleExecuteCommit).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(execute).not.toBeDisabled();
    fireEvent.click(execute);
    expect(editState.handleExecuteCommit).toHaveBeenCalledTimes(1);
  });

  it("[#1111] arming moves focus onto Execute so the muscle-memory Enter confirms", () => {
    vi.useFakeTimers();
    const editState = makeEditState();
    renderDialog(editState);

    const execute = screen.getByTestId("execute-button");
    expect(execute).not.toHaveFocus();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(execute).toHaveFocus();
  });

  it("[#1141c] a second click while a commit is in flight is ignored", () => {
    vi.useFakeTimers();
    // Never-resolving promise keeps the executing state latched.
    const handleExecuteCommit = vi.fn(() => new Promise<void>(() => {}));
    const editState = makeEditState({ handleExecuteCommit });
    renderDialog(editState);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    const execute = screen.getByTestId("execute-button");
    fireEvent.click(execute);
    expect(handleExecuteCommit).toHaveBeenCalledTimes(1);
    // In flight → button is disabled (aria-busy) and re-click is a no-op.
    expect(execute).toBeDisabled();
    expect(execute).toHaveAttribute("aria-busy", "true");
    fireEvent.click(execute);
    expect(handleExecuteCommit).toHaveBeenCalledTimes(1);
  });
});
