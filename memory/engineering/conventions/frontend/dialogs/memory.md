---
title: Dialog conventions
type: convention
updated: 2026-05-27
surface: src/components/**/*.tsx, src/components/ui/dialog/**/*.tsx
task: frontend, ui, dialog
trigger:
  signal: dialog 추가 / dialog 수정 / modal UX 변경
  layer: index
---

# Dialog Conventions

Dialog 구현 규칙은 engineering memory 가 SOT 다. Application dialog 는 기본적으로
Layer 2 preset 을 고르고, Radix/shadcn primitive 직접 조합은 승인된 escape hatch
일 때만 쓴다.

## Layer Contract

| Layer | Files | 책임 |
|---|---|---|
| Layer 1 primitives | `src/components/ui/dialog.tsx`, `src/components/ui/alert-dialog.tsx`, `src/components/ui/tabs.tsx` | Radix wrapper, `data-slot`, tone/layout, close button, feedback slot contract |
| Layer 2 presets | `src/components/ui/dialog/ConfirmDialog.tsx`, `FormDialog.tsx`, `PreviewDialog.tsx`, `TabsDialog.tsx` | 반복 dialog shell, footer/header/feedback wiring |
| Application dialogs | `src/components/**` | form state, parser errors, async outcome, preset prop wiring |

Layer 1 primitive 는 universal contract 를 소유한다:

- `data-slot` selectors: `dialog-content`, `dialog-feedback`,
  `alert-dialog-content` 등은 test contract 다.
- `tone`: `default` / `destructive` / `warning`.
- `DialogHeader.layout`: `row` 기본, 필요 시 `column`.
- `DialogContent.showCloseButton`: dialog 하나에 close button 은 최대 1개.
- `DialogFeedback`: idle/loading/success/error slot 은 stable DOM identity 를 유지한다.

## Preset Rules

- `ConfirmDialog`: yes/no destructive 또는 terminal action. AlertDialog 기반이라 X 버튼은 없다.
- `FormDialog`: input + submit/cancel dialog. Header, body, optional feedback, footer 소유.
- `PreviewDialog`: read-only 또는 review-then-run preview. SQL/MQL 실패 banner contract 포함.
- `TabsDialog`: dialog body 가 tabbed pane 일 때 사용.

Preset 은 Layer 1 만 compose 한다. Application dialog 는 Layer 1 을 직접 import 하지
않고 preset 의 typed props 로 state 를 넘긴다. Width/padding override 는 preset 의
`className` -> `DialogContent` forwarding 으로 해결한다.

## Escape Hatch

Layer 1 직접 사용은 아래 조건을 모두 만족할 때만 허용한다.

1. preset 이 표현하지 못하는 구조 요구가 있다.
2. 파일 상단 주석이 이유와 이 memory path 를 명시한다.
3. close-button matrix 와 stable-feedback test 를 통과한다.

현재 승인된 escape hatch 는 `src/components/connection/ConnectionDialog.tsx` 뿐이다.
이유는 two-group footer, `data-slot="test-feedback"` stable identity, save-error
banner 와 test-feedback slot 분리다. 새 escape hatch 는 sprint contract 에 이유와
회귀 test 를 남긴다.

## Invariant Checklist

- close button 은 dialog 당 최대 1개.
- `ConnectionDialog` 의 `expectNodeStable` contract 를 깨지 않는다.
- SQL/MQL preview 실패 banner 는 `role="alert"`, `aria-live="assertive"`,
  `data-testid="sql-preview-commit-error"` 를 유지한다.
- commit/connection action 이후 toast hookup 을 보존한다.
- `tone`, `layout`, `DialogFeedback` 을 hand-rolled 대체하지 않는다.
- 새 preset 은 `src/components/ui/dialog/__tests__/` 아래 최소 1개 unit test 를 둔다.

## Related

- [frontend](../memory.md)
