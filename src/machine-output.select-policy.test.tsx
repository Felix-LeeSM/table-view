// #2432 — machine output stays liftable.
//
// The policy this PR ships is a trade: drag-selection is off by default, and
// what the user loses is bought back either by an exception in
// `src/index.css` or by a copy button on that screen. The two surfaces below
// have no copy button, so the exception is the only thing standing between
// the user and a value they cannot get out of the app at all — an executed
// statement they need to paste into an editor, a driver error they need to
// paste into a search box.
//
// Both surfaces reach the policy through the element they render, not through
// a class or a wrapper's role: `SqlSyntax` prints into `<code>` and
// `QueryErrorDetail` into `<pre>`. That is deliberately the same mechanism at
// both ends, so this file asserts the property rather than the tag — it asks
// the stylesheet which selector is selectable and then asks the rendered tree
// whether the machine text is inside something matching it. Swapping either
// element back to a `<div>` or `<span>`, or dropping `pre` / `code` from the
// exception list, turns this red from whichever side moved.
//
// `QueryErrorDetail` has three call-sites and two of them sit inside
// `role="alert"`, which the policy also covers; the third (the
// permission-denied panel in `QueryResultGrid`) sits inside `role="status"`,
// which it does not. Fixing the element rather than that one call-site is
// what makes all three safe, so the component is measured directly here
// instead of through the panel that happened to leak.

import { QueryErrorDetail } from "@components/query/QueryErrorDetail";
import { ExecutedQueryBar } from "@components/rdb/DataGrid/ExecutedQueryBar";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { selectableSelector } from "@/test-utils/selectPolicy";

const SQL = 'SELECT * FROM "public"."users" ORDER BY id DESC LIMIT 300';
const DRIVER_ERROR =
  'error returned from database: permission denied for table "users"';

describe("machine output vs. the selection policy (#2432)", () => {
  it("[select-policy] the executed SQL is inside an element the policy keeps selectable", () => {
    render(<ExecutedQueryBar sql={SQL} />);
    const region = screen.getByRole("region", { name: /SQL query/i });

    const holder = region.querySelector(selectableSelector());
    expect(holder?.textContent).toBe(SQL);
  });

  it("[select-policy] an unclassified driver error is inside an element the policy keeps selectable", () => {
    const { container } = render(
      <QueryErrorDetail error={DRIVER_ERROR} collapsible={false} />,
    );

    const holder = container.querySelector(selectableSelector());
    expect(holder?.textContent).toBe(DRIVER_ERROR);
  });

  it("[select-policy] the collapsed copy of that error is selectable once opened", () => {
    const { container } = render(
      <QueryErrorDetail error={DRIVER_ERROR} collapsible />,
    );

    const holder = container.querySelector(selectableSelector());
    expect(holder?.textContent).toBe(DRIVER_ERROR);
  });
});
