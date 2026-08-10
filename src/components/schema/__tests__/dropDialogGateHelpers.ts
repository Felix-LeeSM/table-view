// Shared probes for the DROP dialog preview/execution gate suites
// (`DropColumnDialog` — issue #2157, `DropTableDialog` /
// `DropTriggerDialog` — issue #2191). Both helpers carry a rationale that
// is easy to get wrong, so they live in one place instead of once per
// dialog suite.

import { screen } from "@testing-library/react";

/**
 * The preview pane renders the SQL through `<SqlSyntax>`, which splits it
 * into one `<span>` per token — no single element holds the whole string.
 * Match the `<pre>` wrapper by its `textContent` instead.
 */
export function findPreviewSql(sql: string): Promise<HTMLElement> {
  return screen.findByText(
    (_content, element) =>
      element?.tagName === "PRE" && element.textContent === sql,
  );
}

/**
 * React refuses to deliver a click to a `disabled` button, and it decides
 * that from its own props — clearing the DOM attribute changes nothing
 * (measured on react-dom 19.2.4). So the button's `disabled` binding hides
 * the click handler's own guard from every DOM-level test. Pull the
 * registered `onClick` off the host node instead: that is the entry point a
 * regressed `disabled` binding would expose, and it is the only way to
 * assert the second layer holds on its own.
 */
export function reactOnClick(node: HTMLElement): () => Promise<void> {
  const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
  if (!key) throw new Error("no React props key on the host node");
  const props = (
    node as unknown as Record<string, { onClick?: () => Promise<void> }>
  )[key];
  if (!props?.onClick) throw new Error("no onClick registered on the button");
  return props.onClick;
}
