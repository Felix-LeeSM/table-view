---
title: Workflow
type: index
updated: 2026-07-17
---

# Workflow

사용자-agent 협업 phase 별 행동 계약. 코드 룰은 [engineering/conventions](../engineering/conventions/memory.md) 참조.

## 원칙

- Workflow memory는 "언제 agent가 무엇을 해야 하는가"를 저장한다.
- 긴 절차, 평가 매트릭스, 대화 방식, 구현 방법론은 `.agents/skills/*`로 둔다.
- Workflow는 필요한 skill을 가리키되, skill 본문을 복제하지 않는다.

## 방 지도

- [bug-fix](./bug-fix/memory.md) — 사용자 버그/회귀/UX 이슈 보고 시 처리 순서 (Red 먼저)
- [implementation](./implementation/memory.md) — 구현 phase 의 agent 자율성 + tool output noise 차단
- [tdd](./tdd/memory.md) — code-profile sprint 의 RED evidence / pre-push TDD gate 해석
- [delivery](./delivery/memory.md) — code → commit → push → PR → review → merge 전체 자율 pipeline
- [review](./review/memory.md) — PR 생성 후 독립 read-only review pack을 붙이는 행동 계약
- [documentation](./documentation/memory.md) — 문서화 필요 여부 판단 + 기존 SOT 라우팅 + PR evidence portability
- [git-policy](./git-policy/memory.md) — hook 회피 금지 룰 (commit / push 강제 메커니즘)
- [hooks](./hooks/memory.md) — hook 은 read-only 검증 게이트라는 작성 원칙

## phase 식별

| 신호                                      | phase          | 진입 룰                                                                               |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| 사용자가 새 기능/sprint 빌드 지시         | feature-build  | 표준 진입점 `harness` skill (`.agents/skills/harness/SKILL.md`) — planner→generator→evaluator, PASS 후 [delivery](./delivery/memory.md) 로 배송 |
| 사용자가 버그/회귀/UX 이슈 보고           | bug-fix        | 즉시 [bug-fix](./bug-fix/memory.md) 본문 읽고 Red test 부터                           |
| 사용자가 코드 작성/구현 지시              | implementation | [implementation](./implementation/memory.md) — narration 최소, tool output noise 차단 |
| code-profile sprint 에서 테스트/기능 변경 | tdd            | [tdd](./tdd/memory.md) — 작업 방식 강제가 아니라 delivery evidence 사전 확인          |
| 문서 추가 / PR 작성 / workflow 변경       | documentation  | [documentation](./documentation/memory.md) — impact 판단 후 기존 SOT 반영             |
| 구현 끝 / 사용자가 "마무리해"             | delivery       | [delivery](./delivery/memory.md) — commit → push → PR → review → merge                |
| PR 생성 / 사용자가 "리뷰해"               | review         | [review](./review/memory.md) — 독립 read-only review pack 후 delivery owner 에게 반환 |

## 관련 방

- [engineering/conventions](../engineering/conventions/memory.md) — 코드 룰 (Rust/TS/테스트/주석)
- [product](../product/memory.md) — 제품 UX 머지 기준
- 기능 빌드(planner→generator→evaluator) 표준 진입점은 workflow memory 가 아니라
  `.agents/skills/harness/SKILL.md` 가 source. (sprint-build 2026-07-02 폐기 후 일원화.)
- 결정 / grill 은 workflow memory 가 아니라
  `.agents/skills/grill-with-memory/SKILL.md` 가 source.
- PR review 방법론은 workflow memory 가 아니라 `.agents/skills/pr-review/SKILL.md`
  가 source.
