/**
 * What `document.elementFromPoint` finds at the point WebDriver aims a click at.
 * The browser-side probe lives in `_helpers.ts`; reading it lives here so it can
 * be exercised without a driver.
 */
export type ClickPointHit =
  | { kind: "clear" }
  | { kind: "element"; tag: string; className: string };

export interface ClickPointVerdict {
  /** `null` when nothing stands between the driver and the element. */
  blockedBy: string | null;
  /** Escape clears this blocker and reaches nothing else. */
  closeWithEscape: boolean;
}

export function readClickPoint(hit: ClickPointHit): ClickPointVerdict {
  if (hit.kind === "clear") return { blockedBy: null, closeWithEscape: false };
  return {
    blockedBy: `<${hit.tag} class="${hit.className}">`,
    // CodeMirror binds Escape to closeCompletion, and `autocompletion()` closes
    // the popup on blur, so an open popup means the editor still holds focus
    // and the key lands there instead of on an app shortcut.
    closeWithEscape: hit.className.split(/\s+/).includes("cm-tooltip"),
  };
}
