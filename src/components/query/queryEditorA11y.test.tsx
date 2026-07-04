import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import SqlQueryEditor from "./SqlQueryEditor";
import MongoQueryEditor from "./MongoQueryEditor";
import RedisCommandEditor from "./RedisCommandEditor";
import SearchQueryEditor from "./SearchQueryEditor";

/**
 * #1133 — the accessible name and autocomplete-combobox announcement must
 * live on the *real* editable surface (`.cm-content`), not on a decoy
 * wrapper `<div role="textbox">`. These regressions lock that in for every
 * query editor.
 */

const noop = () => {};

const cases: { name: string; label: string; element: ReactElement }[] = [
  {
    name: "SqlQueryEditor",
    label: "SQL Query Editor",
    element: <SqlQueryEditor sql="" onSqlChange={noop} onExecute={noop} />,
  },
  {
    name: "MongoQueryEditor",
    label: "MongoDB Query Editor",
    element: (
      <MongoQueryEditor
        sql=""
        onSqlChange={noop}
        onExecute={noop}
        mongoExtensions={[]}
      />
    ),
  },
  {
    name: "RedisCommandEditor",
    label: "Redis Command Editor",
    element: <RedisCommandEditor sql="" onSqlChange={noop} onExecute={noop} />,
  },
  {
    name: "SearchQueryEditor",
    label: "Search Query Editor",
    element: <SearchQueryEditor sql="" onSqlChange={noop} onExecute={noop} />,
  },
];

afterEach(cleanup);

describe.each(cases)("$name accessibility (#1133)", ({ label, element }) => {
  it("names the real .cm-content surface, not a wrapper div", () => {
    const { container } = render(element);
    const content = container.querySelector(".cm-content");
    expect(content).not.toBeNull();
    expect(content).toHaveAttribute("aria-label", label);
  });

  it("does not put role=textbox on a decoy wrapper div", () => {
    const { container } = render(element);
    // Every wrapper div carries a data-paradigm marker; none should claim to
    // be the textbox — the real one is CodeMirror's `.cm-content`.
    const wrapper = container.querySelector("[data-paradigm]");
    expect(wrapper).not.toBeNull();
    expect(wrapper).not.toHaveAttribute("role");
    expect(wrapper).not.toHaveAttribute("aria-label");
  });

  it("exposes the autocomplete usage hint to screen readers", () => {
    const { container } = render(element);
    const content = container.querySelector(".cm-content");
    const describedBy = content?.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const hint = container.querySelector(`#${CSS.escape(describedBy!)}`);
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? "").toMatch(/arrow|navigate|화살표/i);
  });
});
