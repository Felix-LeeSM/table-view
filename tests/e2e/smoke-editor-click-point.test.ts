import { describe, expect, it } from "vitest";
import { readClickPoint } from "../../e2e/smoke/editor-click-point";

describe("SQL editor click point", () => {
  it("reports the point as free when nothing covers the editor", () => {
    expect(readClickPoint({ kind: "clear" })).toEqual({
      blockedBy: null,
      closeWithEscape: false,
    });
  });

  it("names CodeMirror's completion popup and clears it with Escape", () => {
    // Class list as dumped by the afterTest hook of the e2e-smoke run that
    // failed on `element click intercepted` (run 32056392988, MySQL smoke).
    const verdict = readClickPoint({
      kind: "element",
      tag: "div",
      className: "cm-tooltip-autocomplete cm-tooltip cm-tooltip-below",
    });

    expect(verdict.blockedBy).toContain("cm-tooltip-autocomplete");
    expect(verdict.closeWithEscape).toBe(true);
  });

  it("names an unknown blocker without aiming Escape at it", () => {
    const verdict = readClickPoint({
      kind: "element",
      tag: "section",
      className: "toast-viewport",
    });

    expect(verdict.blockedBy).toBe('<section class="toast-viewport">');
    expect(verdict.closeWithEscape).toBe(false);
  });
});
