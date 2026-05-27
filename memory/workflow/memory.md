---
title: Workflow
type: index
updated: 2026-05-27
---

# Workflow

User-Claude 협업 phase 별 행동 룰. 코드 룰은 [engineering/conventions](../engineering/conventions/memory.md) 참조, 본 방은 _구현/검증/전달 협업 패턴_.

## 방 지도

- [bug-fix](./bug-fix/memory.md) — 사용자 버그/회귀/UX 이슈 보고 시 처리 순서 (Red 먼저)
- [implementation](./implementation/memory.md) — 구현 phase 의 agent 자율성 + tool output noise 차단
- [tdd](./tdd/memory.md) — code-profile sprint 의 RED evidence / pre-push TDD gate 해석
- [delivery](./delivery/memory.md) — code → commit → push → PR → review → merge 전체 자율 pipeline
- [documentation](./documentation/memory.md) — 문서화 필요 여부 판단 + 기존 SOT 라우팅 + PR evidence portability
- [git-policy](./git-policy/memory.md) — hook 회피 금지 룰 (commit / push 강제 메커니즘)
- [hooks](./hooks/memory.md) — hook 은 read-only 검증 게이트라는 작성 원칙

## phase 식별

| 신호                                      | phase          | 진입 룰                                                                               |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| 사용자가 버그/회귀/UX 이슈 보고           | bug-fix        | 즉시 [bug-fix](./bug-fix/memory.md) 본문 읽고 Red test 부터                           |
| 사용자가 코드 작성/구현 지시              | implementation | [implementation](./implementation/memory.md) — narration 최소, tool output noise 차단 |
| code-profile sprint 에서 테스트/기능 변경 | tdd            | [tdd](./tdd/memory.md) — 작업 방식 강제가 아니라 delivery evidence 사전 확인          |
| 문서 추가 / PR 작성 / workflow 변경       | documentation  | [documentation](./documentation/memory.md) — impact 판단 후 기존 SOT 반영             |
| 구현 끝 / 사용자가 "마무리해"             | delivery       | [delivery](./delivery/memory.md) — commit → push → PR → review → merge                |

## 관련 방

- [engineering/conventions](../engineering/conventions/memory.md) — 코드 룰 (Rust/TS/테스트/주석)
- [product](../product/memory.md) — 제품 UX 머지 기준
- 결정 / grill 은 workflow memory 가 아니라 `.agents/skills/grill-me/SKILL.md` 와
  `.agents/skills/grill-with-memory/SKILL.md` 가 source.
