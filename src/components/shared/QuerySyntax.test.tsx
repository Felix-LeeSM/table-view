import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import QuerySyntax from "./QuerySyntax";

describe("QuerySyntax", () => {
  it("renders SQL tokens when paradigm is 'rdb'", () => {
    const { container } = render(<QuerySyntax sql="SELECT 1" paradigm="rdb" />);
    // SqlSyntax tags `SELECT` as `keyword` → `text-syntax-keyword`.
    const keywordSpan = container.querySelector(".text-syntax-keyword");
    expect(keywordSpan).not.toBeNull();
    expect(keywordSpan?.textContent).toBe("SELECT");
    // Document-specific class must not leak into the SQL branch.
    expect(container.querySelector(".cm-mql-operator")).toBeNull();
  });

  it("renders Mongo tokens when paradigm is 'document'", () => {
    const { container } = render(
      <QuerySyntax sql={'{"$match":1}'} paradigm="document" />,
    );
    const operator = container.querySelector(".cm-mql-operator");
    expect(operator).not.toBeNull();
    expect(operator?.textContent).toBe('"$match"');
  });

  it("falls back to SqlSyntax when paradigm is undefined (legacy)", () => {
    const { container } = render(
      <QuerySyntax sql="SELECT 1" paradigm={undefined} />,
    );
    const keywordSpan = container.querySelector(".text-syntax-keyword");
    expect(keywordSpan).not.toBeNull();
    expect(keywordSpan?.textContent).toBe("SELECT");
    expect(container.querySelector(".cm-mql-operator")).toBeNull();
  });

  it("forwards the `className` to the underlying renderer", () => {
    const { container } = render(
      <QuerySyntax sql="SELECT 1" paradigm="rdb" className="truncate" />,
    );
    const parent = container.firstElementChild as HTMLElement;
    expect(parent.className).toMatch(/truncate/);
  });

  it("renders invalid JSON document entries without throwing", () => {
    expect(() =>
      render(<QuerySyntax sql={'{"$match":{'} paradigm="document" />),
    ).not.toThrow();
  });
});
