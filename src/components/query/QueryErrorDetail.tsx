/**
 * QueryErrorDetail — shows the raw driver error (#1723).
 *
 * When `classifyDriverError` attaches a friendly hint (`collapsible`), the
 * raw text folds into a native `<details>` and yields the primary slot to the
 * friendly message — the fix for a regression where the raw sqlx/driver
 * internal string hid whether the problem was SQL or connection/proxy. When
 * unclassified (fallback), the raw text is shown as is. Either way the
 * diagnostic text is preserved in the DOM.
 *
 * `<details>` reuses this codebase's existing fold-UI convention
 * (SearchResultView / ExplainViewer and others) — it does not add a new
 * collapsible primitive.
 *
 * Rendering the raw text in a `<pre>` is a retrieval path, not a display
 * choice (#2432). Drag selection is off by default and `src/index.css` turns
 * it back on per element, with `pre` on that list. Some call sites of this
 * component sit inside `role="alert"` and were already covered, but the
 * permission-denied panel (the `role="status"` block in
 * `QueryResultGrid.tsx`) was not, so the raw driver error shown there became
 * a value with no way to get it out of this repository. Fixing the element
 * here covers every call site at once, without a wrapper at each one.
 * `<pre>` also gives the same mono presentation as the other places that
 * render a raw error (`src/components/ui/dialog/PreviewDialog.tsx`
 * · `src/components/rdb/DataGrid/SqlPreviewDialog.tsx`).
 */

import { useTranslation } from "react-i18next";

export interface QueryErrorDetailProps {
  error: string;
  /**
   * Whether a friendly hint exists, so the raw text folds. `false` shows the
   * raw text as is (fallback).
   */
  collapsible: boolean;
}

export function QueryErrorDetail({
  error,
  collapsible,
}: QueryErrorDetailProps) {
  const { t } = useTranslation("query");
  if (!collapsible) {
    return (
      <pre className="whitespace-pre-wrap text-xs opacity-80">{error}</pre>
    );
  }
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs opacity-70">
        {t("resultGrid.errorDetails")}
      </summary>
      <pre className="mt-1 whitespace-pre-wrap text-xs opacity-80">{error}</pre>
    </details>
  );
}
