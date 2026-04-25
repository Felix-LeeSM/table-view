import { afterEach, describe, expect, it } from "vitest";
import { isEditableTarget } from "../isEditableTarget";

// jsdom is the test environment, so we can build real DOM nodes here.
// All elements are appended to `document.body` and removed in `afterEach`
// to keep test isolation tight (no orphaned nodes between cases).
const cleanup: Element[] = [];

afterEach(() => {
  while (cleanup.length > 0) {
    const node = cleanup.pop();
    if (node && node.parentNode) {
      node.parentNode.removeChild(node);
    }
  }
});

function track<T extends Element>(node: T): T {
  document.body.appendChild(node);
  cleanup.push(node);
  return node;
}

describe("isEditableTarget", () => {
  it("returns false for null", () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it("returns true for an INPUT element", () => {
    const input = track(document.createElement("input"));
    expect(isEditableTarget(input)).toBe(true);
  });

  it("returns true for a TEXTAREA element", () => {
    const textarea = track(document.createElement("textarea"));
    expect(isEditableTarget(textarea)).toBe(true);
  });

  it("returns true for a SELECT element", () => {
    const select = track(document.createElement("select"));
    expect(isEditableTarget(select)).toBe(true);
  });

  it("returns true for a div with contenteditable", () => {
    const div = track(document.createElement("div"));
    div.setAttribute("contenteditable", "true");
    // jsdom does not compute `isContentEditable` from the attribute the way
    // real browsers do, so we surface the same property production code
    // reads. This mirrors how Chrome/Safari expose it on a focused
    // contenteditable element.
    Object.defineProperty(div, "isContentEditable", {
      configurable: true,
      get: () => true,
    });
    expect(isEditableTarget(div)).toBe(true);
  });

  it("returns false for a regular div", () => {
    const div = track(document.createElement("div"));
    expect(isEditableTarget(div)).toBe(false);
  });

  it("returns false for a button (non-editable interactive element)", () => {
    const button = track(document.createElement("button"));
    expect(isEditableTarget(button)).toBe(false);
  });

  it("returns false for the document body", () => {
    expect(isEditableTarget(document.body)).toBe(false);
  });

  it("returns true for an INPUT regardless of `type` attribute", () => {
    const search = track(document.createElement("input"));
    search.type = "search";
    expect(isEditableTarget(search)).toBe(true);

    const password = track(document.createElement("input"));
    password.type = "password";
    expect(isEditableTarget(password)).toBe(true);
  });
});
