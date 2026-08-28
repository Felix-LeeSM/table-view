/**
 * What `document.elementFromPoint` finds at the point WebDriver aims a click at.
 * The browser-side probe lives in `_helpers.ts`; reading it lives here so it can
 * be exercised without a driver.
 */
export interface ClickPointBlocker {
  kind: "element";
  tag: string;
  className: string;
  /**
   * A `[role="dialog"]` / `[role="alertdialog"]` was mounted when the point was
   * probed. The grid's own Escape handler stands down in that state
   * (`src/components/rdb/DataGrid/useRdbDataGridShortcuts.ts`), because the
   * dialog owns the key.
   */
  dialogOpen: boolean;
}

export type ClickPointHit = { kind: "clear" } | ClickPointBlocker;

export interface ClickPointVerdict {
  /** `null` when nothing stands between the driver and the element. */
  blockedBy: string | null;
  /** Escape clears this blocker and reaches nothing else. */
  closeWithEscape: boolean;
}

function nameBlocker(blocker: ClickPointBlocker): string {
  return `<${blocker.tag} class="${blocker.className}">`;
}

function isEditorPopup(blocker: ClickPointBlocker): boolean {
  return blocker.className.split(/\s+/).includes("cm-tooltip");
}

export function readClickPoint(hit: ClickPointHit): ClickPointVerdict {
  if (hit.kind === "clear") return { blockedBy: null, closeWithEscape: false };
  return {
    blockedBy: nameBlocker(hit),
    // CodeMirror binds Escape to closeCompletion, and `autocompletion()` closes
    // the popup on blur, so an open popup means the editor still holds focus
    // and the key lands there instead of on an app shortcut. An open dialog
    // breaks that premise — it owns Escape, so a key fired here would dismiss
    // the dialog rather than the popup (#2508).
    closeWithEscape: isEditorPopup(hit) && !hit.dialogOpen,
  };
}

/**
 * The sentence `clearSqlEditorClickPoint` hands to `waitUntil` when the point
 * never clears. One sentence per cause (#2508): the editor's own popup
 * outliving the Escape we aimed at it is a different failure from another
 * element landing on the point, and both differ from a guard that held Escape
 * back on purpose. A single shared sentence pointed all of them at "something
 * else covered it", which sent the reviewer of PR #2538 hunting a covering
 * element that was never there.
 */
export function describeStuckClickPoint(blocker: ClickPointBlocker): string {
  const name = nameBlocker(blocker);
  if (!isEditorPopup(blocker)) {
    return `SQL Query Editor click point was covered by ${name} and never cleared`;
  }
  if (blocker.dialogOpen) {
    return `SQL Query Editor click point is under CodeMirror's own popup ${name}; the guard withheld Escape because a dialog owned it`;
  }
  return `Escape did not clear the SQL Query Editor click point: the guard fired it at CodeMirror's own popup ${name} and the point stayed blocked`;
}
