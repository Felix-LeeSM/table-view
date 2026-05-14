# Sprint 303 — Autocomplete popup 다크모드 CSS

**날짜**: 2026-05-14
**범위**: CodeMirror autocomplete tooltip 의 다크모드 토큰 매핑.

## 사용자 보고

> 다크모드에서 자동완성 추천 단어들의 배경이 흰색으로 유지되는데 글씨는
> 흰색이 되어버려서 안 보이는군.

## 진단

`@codemirror/autocomplete` 의 default `tooltips.baseTheme` 가 light 색
(`background:#fff; color:#000`) 을 직접 박는다. 우리 design system 은
`--popover` / `--popover-foreground` 토큰으로 light/dark 분기를 한다 →
popup 은 그 분기를 못 받아 다크모드에서 흰 배경 유지 → editor body 의
다크 fg 가 popup 에도 cascade → 흰 글씨 위 흰 배경.

## 변경

### 신규 — `src/lib/editor/autocompleteTheme.ts`

`EditorView.theme` extension `autocompleteTooltipTheme` 1개. surface :

- `.cm-tooltip` / `.cm-tooltip.cm-tooltip-autocomplete` — popover bg/fg + border
- `.cm-tooltip-autocomplete > ul` — JetBrains Mono + 20em maxHeight
- `.cm-tooltip-autocomplete > ul > li` — popover-fg, 2px/6px padding
- `.cm-tooltip-autocomplete > ul > li[aria-selected]` — primary bg/fg
- `.cm-completionLabel` / `.cm-completionMatchedText` — inherit color + bold 600
- `.cm-completionDetail` — muted-foreground, no italic, 0.5em left margin
- `.cm-completionIcon` — muted-foreground 0.7 opacity, selected 시 primary-fg + opacity 1
- selected 의 `.cm-completionDetail` — primary-fg + 0.85 opacity

### Wire-up — 4 곳

- `src/components/query/SqlQueryEditor.tsx` — import + `extensions` 끝에 추가
- `src/components/query/MongoQueryEditor.tsx` — 동상
- `src/components/document/AddDocumentModal.tsx` — 동상
- `src/components/document/DocumentFilterBar.tsx` — 동상

extension array 끝에 mount 해서 component-local `EditorView.theme` 와
overlay 가 동일 specificity 로 cascade. component theme 은 popup 토큰을
건드리지 않으므로 충돌 없음.

### 신규 — `src/lib/editor/autocompleteTheme.test.ts`

3 case (`it`):

1. popup wrapper 에 `--popover` / `--popover-foreground` token 매핑
2. `aria-selected` 항목에 `--primary` / `--primary-foreground` token
3. `.cm-completionMatchedText` 가 `font-weight: 600`

JSDOM 이 CSS var 를 resolve 하지 않으므로 token *이름이 emit 된 stylesheet
에 포함됐는지* 만 검사 — 실제 색 resolve 는 브라우저 런타임.

## 검증

```
pnpm vitest run                    # 275 files / 3357 passed | 10 skipped (was 3354; +3 sprint-303)
pnpm tsc --noEmit                  # clean
pnpm lint                          # clean
```

## 후속

- Sprint 304 — column = table dup 정공법 (lang-sql schemaCompletionSource
  교체).
- popup affordance polish (예: column type detail surface — `int`, `text`)
  는 별도 backlog.
