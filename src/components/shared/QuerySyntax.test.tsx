import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import QuerySyntax from "./QuerySyntax";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useTabStore } from "@stores/tabStore";

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

  it("accepts a queryMode prop without using it (forward-compat)", () => {
    // The component accepts queryMode for both rdb and document paradigms
    // but currently delegates by paradigm alone. This guards the signature.
    const { container: rdbContainer } = render(
      <QuerySyntax sql="SELECT 1" paradigm="rdb" queryMode="sql" />,
    );
    expect(rdbContainer.querySelector(".text-syntax-keyword")).not.toBeNull();

    const { container: docContainer } = render(
      <QuerySyntax
        sql={'{"$match":1}'}
        paradigm="document"
        queryMode="aggregate"
      />,
    );
    expect(docContainer.querySelector(".cm-mql-operator")).not.toBeNull();
  });

  it("forwards the `className` to the underlying renderer", () => {
    const { container } = render(
      <QuerySyntax sql="SELECT 1" paradigm="rdb" className="truncate" />,
    );
    const parent = container.firstElementChild as HTMLElement;
    expect(parent.className).toMatch(/truncate/);
  });

  it("does not mutate the queryHistoryStore or tabStore during render", () => {
    const historyBefore = useQueryHistoryStore.getState();
    const tabBefore = useTabStore.getState();
    render(<QuerySyntax sql={'{"$match":1}'} paradigm="document" />);
    render(<QuerySyntax sql="SELECT 1" paradigm="rdb" />);
    render(<QuerySyntax sql="SELECT 1" paradigm={undefined} />);
    expect(useQueryHistoryStore.getState()).toBe(historyBefore);
    expect(useTabStore.getState()).toBe(tabBefore);
  });

  it("renders invalid JSON document entries without throwing", () => {
    expect(() =>
      render(<QuerySyntax sql={'{"$match":{'} paradigm="document" />),
    ).not.toThrow();
  });
});
