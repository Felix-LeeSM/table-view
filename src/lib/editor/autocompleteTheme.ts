import { EditorView } from "@codemirror/view";

/**
 * Sprint 303 (2026-05-14) — CodeMirror autocomplete popup 의 다크모드 토큰
 * 매핑.
 *
 * `@codemirror/autocomplete` 의 default `tooltips.baseTheme` 는 light 색을
 * 직접 박아 (`background:#fff; color: …`) 다크 모드에서도 동일. 우리 테마는
 * `--popover` / `--popover-foreground` design token 으로 light/dark 를 분기
 * 하므로, popup 도 같은 token 으로 매핑해 두 모드 모두 가독성을 확보한다.
 *
 * SqlQueryEditor / MongoQueryEditor / DocumentFilterBar / AddDocumentModal
 * 가 동일 mount — 두 paradigm 의 popup tone 이 일치.
 */
export const autocompleteTooltipTheme = EditorView.theme({
  ".cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    maxHeight: "20em",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    color: "var(--popover-foreground)",
    padding: "2px 6px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--primary)",
    color: "var(--primary-foreground)",
  },
  ".cm-completionLabel": { color: "inherit" },
  ".cm-completionMatchedText": {
    color: "inherit",
    textDecoration: "none",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    color: "var(--muted-foreground)",
    fontStyle: "normal",
    marginLeft: "0.5em",
  },
  ".cm-completionIcon": {
    color: "var(--muted-foreground)",
    opacity: "0.7",
    paddingRight: "0.4em",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon": {
    color: "var(--primary-foreground)",
    opacity: "1",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "var(--primary-foreground)",
    opacity: "0.85",
  },
});
