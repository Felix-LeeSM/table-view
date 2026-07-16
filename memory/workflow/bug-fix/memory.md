---
title: 버그 fix — Red test 먼저
type: workflow-rule
updated: 2026-05-17
task: bug-fix, regression-test, user-report
trigger:
  signal: 사용자가 버그/회귀/UX 이슈 보고
  layer: agent-prompt (bug-fix agent 진입)
---

# 버그 fix — Red test 먼저

사용자 보고 받은 모든 버그/회귀/UX 이슈는 **fix 코드를 쓰기 전에 그 버그를 잡아내는 test 부터** 작성.

## 순서

1. **Red** — failing test 작성. 사용자 보고 증상 그대로 재현. assertion 이 사용자가 본 wrong behavior 를 직접 포착해야 함.
   - 예: "launcher window 가 connection 켠 후에도 visible == true" 라는 증상을 그대로 assertion 으로.
2. **Green** — fix 구현.
3. **Verify** — test 가 green 으로 전환, 다른 test 회귀 없음 확인.
4. **Commit** — regression test + fix 한 commit 에. (delivery 의 직접 commit 룰 적용 — [delivery](../delivery/memory.md))

## Why

- test 없이 fix 만 하면 회귀 가드 부재 → 같은 버그 추후 재발. 사용자가 같은 버그 두 번 보고.
- 사용자가 본 증상 자체를 assertion 으로 박아야 회귀 잠금. "비슷한 동작 test" 가 아니라 "사용자 본 그 증상".
- 결정 시점: 2026-05-16, sprint-367 머지 직후 launcher 이중 창 / 테마 빈 부팅 회귀 2건 보고 직후.

## 금지 패턴

- "fix 하고 그 다음에 시간 되면 test" → 금지. test 먼저.
- "기존 test 가 비슷한 영역 커버하니까 추가 안 함" → 금지. 사용자 본 증상이 새 assertion 으로 박혀야 함.
- "회귀 메모만 남기고 fix 만" → 금지. 메모는 추가 기록일 뿐.

## 적용 예 (참고)

2026-05-16 회귀 2건:

- launcher 이중 창 → fix 전 e2e 또는 단위 test: `open_workspace_window` 호출 후 launcher window 의 `visible === false` assert.
- 테마 빈 부팅 → fix 전 unit test: `loadAllFromSnapshot` 가 `theme: null` 응답 받았을 때 store 의 `themeId === "default"` + `mode === "system"` assert.

## 관련

- [diagnose skill](../../../.agents/skills/diagnose/SKILL.md) — 재현/원인 어려운 버그·성능 회귀는 진단 루프 (피드백 신호 구축 → 이분법 → 계측 → 회귀 test) 진입점.
- `grill-with-memory` skill — 사용자 보고가 명확하지 않으면 먼저 증상 lock
- [implementation](../implementation/memory.md) — Red 작성 후 Green 단계 narration / noise 룰
- [delivery](../delivery/memory.md) — fix 끝나면 자율 commit/push
- [engineering/conventions/testing-scenarios](../../engineering/conventions/testing-scenarios/memory.md) — 시나리오 8원칙
- [engineering/conventions/testing-scenarios/mock-scope](../../engineering/conventions/testing-scenarios/mock-scope/memory.md) — mock 범위 룰 (assertion 이 user-facing invariant 잡도록)
