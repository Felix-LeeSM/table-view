# Sprint 344 / Slice C Evaluation Scorecard

평가자: orchestrator (Slice B/D 패턴 재사용 + 코드 inspection + 명령 재실행).

| Dimension | Score | Notes |
|-----------|-------|-------|
| Design Quality | 8/10 | `AddItemRow` (DocumentTreePanel.tsx:998) 는 Slice B 의 `AddKeyRow` 패턴 mirror — index label `[N]` `text-muted-foreground` muted, dashed button, 일관. `onMouseDown preventDefault` 로 label 클릭 시 value input focus 유지 (jsdom + 실 브라우저 양쪽 안전). |
| Completeness | 9/10 | AC-344-C-01 ~ 10 모두 cover (12 신규 test). AC-09 가 09a/09b 로 split (number / array coerce). Host wrapper 로 AC-06 (연속 add) 시 grid round-trip 모사. |
| Functionality | 9/10 | `nextItemIndex` = `baseLength + max(prior pending bracket-index) + 1` — append-only 가 자연스럽게 `baseLength + count` 로 환원. `tags[2].name` 같은 nested-edit pending 은 카운트 제외 (직접 `<path>[N]` 만). 45/45 vitest pass. |
| Accessibility & Responsiveness | 9/10 | Index label `<span aria-hidden>`, value input `aria-label="Add item to <arrayPath>"`. Single input — Tab/Shift+Tab 불필요. Esc/Enter only. |
| **Overall** | **8.75/10** | |

## Verdict: PASS

## Sprint Contract Status

- [x] AC-344-C-01 — `AC-344-C-01: renders + item affordance on array nodes only when onCommitEdit is provided` (test.tsx:777)
- [x] AC-344-C-02 — `AC-344-C-02: clicking + item reveals [N] label + value input (auto-focused)` (test.tsx:806)
- [x] AC-344-C-03 — `AC-344-C-03: Enter commits exactly once with bracket path and coerced value` — `commit("tags[2]", 42)`
- [x] AC-344-C-04 — `AC-344-C-04: Esc closes the input without committing`
- [x] AC-344-C-05 — `AC-344-C-05: empty value + Enter commits empty string`
- [x] AC-344-C-06 — `AC-344-C-06: two consecutive + item commits use sequential indexes` — Host wrapper
- [x] AC-344-C-07 — `AC-344-C-07: nested array + item commits the joined bracket path` — `commit("meta.tags[1]", "y")`
- [x] AC-344-C-08 — `AC-344-C-08: index label is a read-only span, not an input` — `tagName === "SPAN"`
- [x] AC-344-C-09 — `AC-344-C-09a` (number coerce) + `AC-344-C-09b` (JSON-array coerce)
- [x] AC-344-C-10 — `AC-344-C-10: first add on an empty array uses index [0]`

## Verification

- `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` — 45/45 pass
- `pnpm tsc --noEmit` — clean
- `pnpm lint` — clean
- `pnpm vitest run` 전체 — 3908 pass, 10 skipped, 2 fail (autocompleteTheme.test.ts — user parallel, 무관)

## Scope Discipline

✓ 오직 `DocumentTreePanel.{tsx,test.tsx}` 두 파일만 수정. git status 깨끗.

## Findings

없음 (PASS). 한 가지 cosmetic 메모 — index label 의 `text-muted-foreground` 가 시각적으로 다른 leaf row 들의 type tag 와 색 차이가 약함. 추후 사용자 피드백 시 개선 가능. AC 에 없는 항목이라 deferred.

## 후속

Slice E (Generator dispatch) 가 이 `[N]` bracket-path 표기를 그대로 사용 — sqlGenerator 의 `extraIndexes` 와 mqlGenerator 의 `tags.N` (Mongo 는 dot, RDB 는 bracket — joinPath 가 이미 분기) 매핑이 Slice E 의 핵심 검증 포인트.
