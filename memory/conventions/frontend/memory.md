---
title: Frontend guidance
type: convention
updated: 2026-05-20
surface: src/**/*.ts, src/**/*.tsx, src/**/*.css
task: frontend, ui, react-impl
trigger:
  signal: src frontend/UI 편집 시
  layer: agent-prompt
---

# Frontend Guidance

앱 첫 화면은 작업 도구다. marketing hero / 과장된 장식보다 반복 사용자가
빠르게 스캔하고 조작하는 밀도 높은 UI 를 우선한다.

## Source Order

1. 기존 컴포넌트 / token / interaction pattern
2. [react](../react/memory.md)
3. [testing-scenarios](../testing-scenarios/memory.md)
4. 본 문서

## UI 원칙

- 카드 중첩 금지. 반복 item / modal / tool frame 에만 card 사용.
- 버튼은 가능한 lucide icon + tooltip. 텍스트 버튼은 명확한 command 에만.
- 고정 형식 UI(board, grid, toolbar, tile)는 `aspect-ratio`, `grid`, `min/max`
  등으로 stable dimension 확보.
- viewport 기반 font scaling 금지. compact surface 안의 heading 은 작고 조밀하게.
- palette 는 단일 hue 로 밀지 않음. 기존 token 우선, 새 색은 contrast 검증.
- 텍스트가 버튼/칩/카드 안에서 넘치거나 겹치면 layout bug 로 본다.

## Workflow

- UI 변경은 `npm run lint`, `npx tsc --noEmit`, 관련 Vitest 를 통과시킨다.
- 접근성은 role/text 쿼리로 검증한다. `data-testid` 는 역할/텍스트가 없을 때만.
- 시각 회귀 위험이 있으면 Playwright/browser screenshot 으로 실제 viewport 확인.

## 관련

- [react](../react/memory.md)
- [testing-scenarios](../testing-scenarios/memory.md)
- [refactoring](../refactoring/memory.md)
