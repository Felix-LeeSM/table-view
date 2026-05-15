import { EditorView } from "@codemirror/view";

/**
 * CodeMirror autocomplete popup 의 다크모드 토큰 매핑 + UX 향상.
 *
 * 2026-05-15 — 토큰 이름 보정. 이전 버전은 `var(--popover)` /
 * `var(--primary)` 같은 *raw* CSS variable 을 참조했는데, 이 프로젝트의
 * design token 은 `--tv-primary` (themes.css) 와 `--color-primary`
 * (index.css 의 Tailwind `@theme inline`) 으로만 정의된다. `--primary`
 * 단독은 어디에도 없어서 `background-color: var(--primary)` 가 invalid 로
 * 떨어졌고, 그래서 active 항목 highlight 가 사용자 눈에 "티가 안 나는"
 * 회색으로 보였다. 모든 참조를 `--tv-*` raw 변수로 교체해 background
 * 변화가 실제로 적용되도록 한다.
 *
 * UX 패키지 (옵션 1·2·4·5·6):
 *   - 옵션 1: active 항목 좌측 3px accent bar. `--tv-ring` 토큰 (focus
 *     ring) 재사용.
 *   - 옵션 2: popup 하단 키 안내 hint bar (`↑↓ · ⏎/⇥ · Esc`).
 *   - 옵션 4: completion `type` 별 아이콘 색 분기.
 *   - 옵션 5: `.cm-completionDetail` 스타일.
 *   - 옵션 6: `.cm-completionInfo` 우측 패널 토큰 매핑.
 *
 * SqlQueryEditor / MongoQueryEditor / DocumentFilterBar / AddDocumentModal
 * 가 동일 mount — 두 paradigm 의 popup tone 이 일치.
 */
export const autocompleteTooltipTheme = EditorView.theme({
  ".cm-tooltip": {
    backgroundColor: "var(--tv-popover)",
    color: "var(--tv-popover-foreground)",
    border: "1px solid var(--tv-border)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--tv-popover)",
    color: "var(--tv-popover-foreground)",
    border: "1px solid var(--tv-border)",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.18), 0 2px 4px rgba(0, 0, 0, 0.12)",
    overflow: "hidden",
    "&::after": {
      content: '"↑↓ navigate  ·  ⏎ / Tab accept  ·  Esc close"',
      display: "block",
      borderTop: "1px solid var(--tv-border)",
      padding: "4px 10px",
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSize: "10.5px",
      letterSpacing: "0.02em",
      color: "var(--tv-muted-foreground)",
      background: "var(--tv-popover)",
    },
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    maxHeight: "20em",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    color: "var(--tv-popover-foreground)",
    padding: "2px 6px",
    boxShadow: "inset 3px 0 0 transparent",
  },
  // active 항목 — `--tv-primary` 가 실제 보라/파랑 (테마별로 ~ #4f46e5 /
  // #818cf8 / #0969da). 이전엔 정의 안 된 `--primary` 라 background 가
  // 안 바뀌어 cue 가 거의 없었다. 가독성 위해 `!important` 로 못박아
  // CodeMirror default 의 hover background 가 active 위에 덮어쓰지 않도록.
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--tv-primary) !important",
    color: "var(--tv-primary-foreground) !important",
    boxShadow: "inset 3px 0 0 var(--tv-ring)",
  },
  ".cm-completionLabel": { color: "inherit" },
  ".cm-completionMatchedText": {
    color: "inherit",
    textDecoration: "none",
    fontWeight: "600",
  },
  ".cm-completionDetail": {
    color: "var(--tv-muted-foreground)",
    fontStyle: "normal",
    marginLeft: "0.5em",
  },
  ".cm-completionIcon": {
    color: "var(--tv-muted-foreground)",
    opacity: "0.85",
    paddingRight: "0.4em",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionIcon": {
    color: "var(--tv-primary-foreground)",
    opacity: "1",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected] .cm-completionDetail": {
    color: "var(--tv-primary-foreground)",
    opacity: "0.85",
  },
  ".cm-completionIcon-function": { color: "#5fb3ff" },
  ".cm-completionIcon-class": { color: "#8de28d" },
  ".cm-completionIcon-keyword": { color: "#f0a85a" },
  ".cm-completionIcon-property": { color: "#ff9bd6" },
  ".cm-completionIcon-type": { color: "#c9a9ff" },
  ".cm-completionInfo": {
    backgroundColor: "var(--tv-popover)",
    color: "var(--tv-popover-foreground)",
    border: "1px solid var(--tv-border)",
    borderRadius: "6px",
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.18), 0 2px 4px rgba(0, 0, 0, 0.12)",
    padding: "8px 10px",
    maxWidth: "320px",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    fontSize: "12px",
    lineHeight: "1.5",
  },
  ".cm-completionInfo code": {
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: "11.5px",
    background: "rgba(127, 127, 127, 0.15)",
    padding: "1px 4px",
    borderRadius: "3px",
  },
});
