---
title: Workflow
type: index
updated: 2026-05-17
---

# Workflow

User-Claude 협업 phase 별 행동 룰. 코드 룰은 [conventions](../conventions/memory.md) 참조, 본 방은 *사용자와의 협업 패턴*.

## 방 지도

- [bug-fix](./bug-fix/memory.md) — 사용자 버그/회귀/UX 이슈 보고 시 처리 순서 (Red 먼저)
- [grill](./grill/memory.md) — 결정 인터뷰 룰 (1q/메시지, 두 축 옵션 분해, html 시각화). sub-room: [security-handoff](./grill/security-handoff/memory.md)
- [implementation](./implementation/memory.md) — 구현 phase 의 agent 자율성 + tool output noise 차단
- [delivery](./delivery/memory.md) — code → commit → push → PR → review → merge 전체 자율 pipeline
- [documentation](./documentation/memory.md) — 문서화 필요 여부 판단 + 기존 SOT 라우팅 + PR evidence portability
- [git-policy](./git-policy/memory.md) — hook 회피 금지 룰 (commit / push 강제 메커니즘)
- [hooks](./hooks/memory.md) — hook script 작성 룰 (ref mutation 금지, read-only verification)

## phase 식별

| 신호 | phase | 진입 룰 |
|---|---|---|
| 사용자가 버그/회귀/UX 이슈 보고 | bug-fix | 즉시 [bug-fix](./bug-fix/memory.md) 본문 읽고 Red test 부터 |
| 사용자가 결정/선택지 묻거나 grill 요청 | grill | [grill](./grill/memory.md) — 1q/메시지, 옵션은 두 축 |
| 사용자가 코드 작성/구현 지시 | implementation | [implementation](./implementation/memory.md) — narration 최소, tool output noise 차단 |
| 문서 추가 / PR 작성 / workflow 변경 | documentation | [documentation](./documentation/memory.md) — impact 판단 후 기존 SOT 반영 |
| 구현 끝 / 사용자가 "마무리해" | delivery | [delivery](./delivery/memory.md) — commit → push → PR → review → merge |

## 관련 방

- [conventions](../conventions/memory.md) — 코드 룰 (Rust/TS/테스트/주석)
- [ux](../ux/memory.md) — 제품 UX 머지 기준
- [decisions](../decisions/memory.md) — workflow 룰을 만든 결정 이력
