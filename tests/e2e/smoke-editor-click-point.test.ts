import { describe, expect, it } from "vitest";
import {
  type ClickPointBlocker,
  describeStuckClickPoint,
  readClickPoint,
} from "../../e2e/smoke/editor-click-point";

// Class list as dumped by the afterTest hook of the e2e-smoke run that failed
// on `element click intercepted` (run 32056392988, MySQL smoke).
const POPUP: ClickPointBlocker = {
  kind: "element",
  tag: "div",
  className: "cm-tooltip-autocomplete cm-tooltip cm-tooltip-below",
  dialogOpen: false,
};

const STRANGER: ClickPointBlocker = {
  kind: "element",
  tag: "section",
  className: "toast-viewport",
  dialogOpen: false,
};

describe("SQL editor click point", () => {
  it("reports the point as free when nothing covers the editor", () => {
    expect(readClickPoint({ kind: "clear" })).toEqual({
      blockedBy: null,
      closeWithEscape: false,
    });
  });

  it("names CodeMirror's completion popup and clears it with Escape", () => {
    const verdict = readClickPoint(POPUP);

    expect(verdict.blockedBy).toContain("cm-tooltip-autocomplete");
    expect(verdict.closeWithEscape).toBe(true);
  });

  it("names an unknown blocker without aiming Escape at it", () => {
    const verdict = readClickPoint(STRANGER);

    expect(verdict.blockedBy).toBe('<section class="toast-viewport">');
    expect(verdict.closeWithEscape).toBe(false);
  });

  it("[escape-scope] withholds Escape while a dialog is open, popup or not", () => {
    // The key would land on the dialog, which owns Escape while it is mounted
    // (`src/components/rdb/DataGrid/useRdbDataGridShortcuts.ts`), so the guard
    // stands down rather than dismissing state the spec still needs (#2508).
    expect(readClickPoint({ ...POPUP, dialogOpen: true })).toEqual({
      blockedBy: readClickPoint(POPUP).blockedBy,
      closeWithEscape: false,
    });
    expect(
      readClickPoint({ ...STRANGER, dialogOpen: true }).closeWithEscape,
    ).toBe(false);
  });
});

describe("stuck click point message", () => {
  it("blames the Escape it fired when the editor's own popup is the blocker", () => {
    const message = describeStuckClickPoint(POPUP);

    expect(message).toContain("Escape did not clear");
    expect(message).toContain("cm-tooltip-autocomplete");
    // The defect this closes: one sentence for both causes sent the reviewer
    // of PR #2538 looking for another element that was never there.
    expect(message).not.toBe(describeStuckClickPoint(STRANGER));
  });

  it("blames the covering element when something else took the point", () => {
    const message = describeStuckClickPoint(STRANGER);

    expect(message).toContain("was covered by");
    expect(message).toContain("toast-viewport");
  });

  it("[escape-scope] says a dialog owned Escape when the guard withheld it", () => {
    const message = describeStuckClickPoint({ ...POPUP, dialogOpen: true });

    expect(message).toContain("withheld Escape because a dialog owned it");
    expect(message).not.toBe(describeStuckClickPoint(POPUP));
  });
});
