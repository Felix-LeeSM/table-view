import { describe, expect, it } from "vitest";
import {
  isGridEditorLabelMatch,
  normalizeGridEditorLabel,
} from "../../e2e/smoke/grid-edit-label";

describe("grid edit label matching", () => {
  it("matches Oracle uppercase column editor labels", () => {
    expect(isGridEditorLabelMatch("Editing NAME", "Editing name")).toBe(true);
    expect(normalizeGridEditorLabel("Editing NAME")).toBe("editing name");
  });

  it("does not match different editor labels", () => {
    expect(isGridEditorLabelMatch("Editing EMAIL", "Editing name")).toBe(false);
    expect(isGridEditorLabelMatch(null, "Editing name")).toBe(false);
  });
});
