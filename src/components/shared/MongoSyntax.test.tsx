import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import MongoSyntax from "./MongoSyntax";

describe("MongoSyntax", () => {
  it("renders empty input without throwing", () => {
    expect(() => render(<MongoSyntax sql="" />)).not.toThrow();
  });

  it("wraps operator tokens in a span carrying the `cm-mql-operator` class", () => {
    const { container } = render(
      <MongoSyntax sql={'{"$match": {"$eq": 1}}'} />,
    );
    const matchSpan = Array.from(
      container.querySelectorAll<HTMLSpanElement>("span.cm-mql-operator"),
    );
    expect(matchSpan.length).toBeGreaterThanOrEqual(2);
    const texts = matchSpan.map((el) => el.textContent);
    expect(texts).toContain('"$match"');
    expect(texts).toContain('"$eq"');
  });

  it("does not emit `cm-mql-operator` spans for plain JSON without operators", () => {
    const { container } = render(<MongoSyntax sql={'{"status":"active"}'} />);
    const operatorSpans = container.querySelectorAll(".cm-mql-operator");
    expect(operatorSpans).toHaveLength(0);
  });

  it("does not throw on invalid / truncated JSON", () => {
    expect(() => render(<MongoSyntax sql={'{"$match":{'} />)).not.toThrow();
  });

  it("applies the supplied className on the parent span alongside font-mono", () => {
    const { container } = render(
      <MongoSyntax sql={'{"a":1}'} className="truncate text-xs" />,
    );
    const parent = container.firstElementChild as HTMLElement;
    expect(parent.tagName).toBe("SPAN");
    expect(parent.className).toMatch(/font-mono/);
    expect(parent.className).toMatch(/truncate/);
    expect(parent.className).toMatch(/text-xs/);
  });

  it("renders the full source bytes inside the parent span", () => {
    const src = '{"$match": {"$eq": 1}}';
    const { container } = render(<MongoSyntax sql={src} />);
    expect(container.textContent).toBe(src);
  });
});
