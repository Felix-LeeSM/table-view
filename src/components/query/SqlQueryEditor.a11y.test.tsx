import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import SqlQueryEditor from "./SqlQueryEditor";

/**
 * #1142 — the CodeMirror line-number gutter is a decorative column of digits.
 * CM6 offers no facet to attribute the `.cm-gutters` DOM, so `SqlQueryEditor`
 * hides it from the accessibility tree at mount via `hideGutterFromA11y`.
 * Guard that the gutter carries `aria-hidden="true"` so screen readers skip
 * the stray line-number column and land on the real `.cm-content` surface.
 */
describe("SqlQueryEditor a11y — decorative gutter (#1142)", () => {
  it("marks the line-number gutter aria-hidden", async () => {
    const { container } = render(
      <SqlQueryEditor
        sql="SELECT 1"
        onSqlChange={vi.fn()}
        onExecute={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector(".cm-gutters")).not.toBeNull(),
    );
    const gutters = container.querySelector(".cm-gutters");
    expect(gutters?.getAttribute("aria-hidden")).toBe("true");
  });
});
