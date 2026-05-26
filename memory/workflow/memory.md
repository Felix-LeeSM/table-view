---
title: Workflow
type: index
updated: 2026-05-17
---

# Workflow

User-Claude 협업 phase 별 행동 룰. 코드 룰은 [conventions](../conventions/memory.md) 참조, 본 방은 _사용자와의 협업 패턴_.

## 방 지도

- [bug-fix](./bug-fix/memory.md) — 사용자 버그/회귀/UX 이슈 보고 시 처리 순서 (Red 먼저)
- [grill](./grill/memory.md) — 결정 인터뷰 룰 (1q/메시지, 두 축 옵션 분해, html 시각화). sub-room: [security-handoff](./grill/security-handoff/memory.md)
- [implementation](./implementation/memory.md) — 구현 phase 의 agent 자율성 + tool output noise 차단
- [harness](./harness/memory.md) — `/harness` multi-agent sprint workflow SOT
- [tdd](./tdd/memory.md) — code-profile sprint 의 RED evidence / pre-push TDD gate 해석
- [delivery](./delivery/memory.md) — code → commit → push → PR → review, merge는 user review 후
- [documentation](./documentation/memory.md) — 문서화 필요 여부 판단 + 기존 SOT 라우팅 + PR evidence portability
- [git-policy](./git-policy/memory.md) — hook 회피 금지 룰 (commit / push 강제 메커니즘)
- [hooks](./hooks/memory.md) — hook script 작성 룰 (ref mutation 금지, read-only verification)

## phase 식별

| 신호                                      | phase          | 진입 룰                                                                               |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| 사용자가 버그/회귀/UX 이슈 보고           | bug-fix        | 즉시 [bug-fix](./bug-fix/memory.md) 본문 읽고 Red test 부터                           |
| 사용자가 결정/선택지 묻거나 grill 요청    | grill          | [grill](./grill/memory.md) — 1q/메시지, 옵션은 두 축                                  |
| 사용자가 /harness 요청 또는 harness 개선 논의 | harness        | [harness](./harness/memory.md) — workflow SOT 먼저, automation 은 이후                 |
| 사용자가 코드 작성/구현 지시              | implementation | [implementation](./implementation/memory.md) — narration 최소, tool output noise 차단 |
| code-profile sprint 에서 테스트/기능 변경 | tdd            | [tdd](./tdd/memory.md) — 작업 방식 강제가 아니라 delivery evidence 사전 확인          |
| 문서 추가 / PR 작성 / workflow 변경       | documentation  | [documentation](./documentation/memory.md) — impact 판단 후 기존 SOT 반영             |
| 구현 끝 / 사용자가 "마무리해"             | delivery       | [delivery](./delivery/memory.md) — commit → push → PR → review, merge는 user review 후 |

## 관련 방

- [conventions](../conventions/memory.md) — 코드 룰 (Rust/TS/테스트/주석)
- [ux](../ux/memory.md) — 제품 UX 머지 기준
- [decisions](../decisions/memory.md) — workflow 룰을 만든 결정 이력
