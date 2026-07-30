---
title: Workflow
type: index
updated: 2026-07-29
---

# Workflow

사용자-agent 협업 phase 별 행동 계약. 코드 룰은 [engineering/conventions](../engineering/conventions/memory.md) 참조.

## 원칙

- Workflow memory는 "언제 agent가 무엇을 해야 하는가"를 저장한다.
- 긴 절차, 평가 매트릭스, 대화 방식, 구현 방법론을 담던 `.agents/skills/*` 는
  삭제됐다 (#2033). 계약을 넘는 내용이 필요하면 방을 쪼개 여기 적는다.

## 방 지도

- [bug-fix](./bug-fix/memory.md) — 사용자 버그/회귀/UX 이슈 보고 시 처리 순서 (Red 먼저)
- [implementation](./implementation/memory.md) — 구현 phase 의 agent 자율성 + tool output noise 차단
- [tdd](./tdd/memory.md) — code-profile sprint 의 RED evidence / pre-push TDD gate 해석
- [delivery](./delivery/memory.md) — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 계약 (구현자는 PR 생성에서 끝난다)
- [review](./review/memory.md) — PR 생성 후 독립 read-only review pack을 붙이는 행동 계약
- [orchestration](./orchestration/memory.md) — 병렬 작업 spawn · 리뷰 큐 직렬화 · 사이클 정지 · 이슈 수용기준
- [documentation](./documentation/memory.md) — 문서화 필요 여부 판단 + 기존 SOT 라우팅 + PR evidence portability
- [git-policy](./git-policy/memory.md) — hook 회피 금지 룰 (commit / push 강제 메커니즘)
- [hooks](./hooks/memory.md) — hook 은 read-only 검증 게이트라는 작성 원칙

## phase 식별

| 신호                                      | phase          | 진입 룰                                                                               |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| 사용자가 새 기능 빌드 지시                | implementation | 티켓부터 — `issue-refine` 이 범위·수용 기준을 채우고 `issue-implement` 가 [implementation](./implementation/memory.md) 을 따른다 |
| 사용자가 버그/회귀/UX 이슈 보고           | bug-fix        | 즉시 [bug-fix](./bug-fix/memory.md) 본문 읽고 Red test 부터                           |
| 사용자가 코드 작성/구현 지시              | implementation | [implementation](./implementation/memory.md) — narration 최소, tool output noise 차단 |
| code-profile sprint 에서 테스트/기능 변경 | tdd            | [tdd](./tdd/memory.md) — 작업 방식 강제가 아니라 delivery evidence 사전 확인          |
| 문서 추가 / PR 작성 / workflow 변경       | documentation  | [documentation](./documentation/memory.md) — impact 판단 후 기존 SOT 반영             |
| 구현 끝 / 사용자가 "마무리해"             | delivery       | [delivery](./delivery/memory.md) — 구현자가 커밋 → 푸시 → PR 생성까지. 리뷰·머지·정리는 다른 node |
| PR 생성 / 사용자가 "리뷰해"               | review         | [review](./review/memory.md) — 독립 read-only review pack, 판정은 label 로 공표      |
| 여러 작업 동시 진행 / 이슈 발행 / 리뷰 라운드가 안 끝남 | orchestration | [orchestration](./orchestration/memory.md) — 티켓의 파일 범위로 교집합 측정, 리뷰 큐 직렬화, 사이클이면 정지·보고 |

## 관련 방

- [engineering/conventions](../engineering/conventions/memory.md) — 코드 룰 (Rust/TS/테스트/주석)
- [product](../product/memory.md) — 제품 UX 머지 기준
- 기능 빌드의 planner→generator→evaluator 하네스는 2026-07-30 폐기 (#1987) —
  import 이후 672커밋 동안 산출물 0(전 히스토리 798)이었고 node 모델(#1918)이
  `issue-refine` → `issue-implement` → `pr-reviewer` 로 대체한다.
- 결정 / grill 절차(`grill-with-memory`)와 PR review 방법론(`pr-review`) 을
  소유하던 skill 은 삭제됐다. 두 주제 모두 지금은 SOT 가 없다.
