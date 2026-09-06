---
title: Delivery — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 행동 계약
type: workflow-rule
updated: 2026-09-06
task: delivery, commit, push, pr, review, merge
keywords: 커밋, commit, push, PR 생성, squash, 머지 정책, review:approved, reflect:done, 자율 실행, 중단 조건, 회고 모드 진입 조건, GPG, pinentry, 노드 표, pr-artifacts
trigger:
  signal: implementation 완료 / 사용자가 "마무리해" / sprint 종료
  layer: none — 자동 로드 없음, 직접 열어야 함
---

# Delivery — 행동 계약

작업 종료 시 구현자가 commit → push → PR 생성까지 자율 실행하고 결과를 남기고
죽는다. 사용자에게 "이제 커밋해 주세요" 안내 금지. 리뷰 부착·라운드 판정·머지·정리는
그 뒤의 다른 node 가 하고, 무엇을 언제 띄울지는 orchestrator 가 label 로 정한다.

이 방은 **행동 계약**(누가·언제·무엇을 지켜야 하나)만 둔다. 구현자 절차의 상세
SOT 는 없다.

## Node 별 계약

한 node 는 한 가지 행동을 하고, 상태(label + 결과 기록)를 남기고 죽는다. node 가
다음 node 를 부르지 않는다 — orchestrator 가 빈 slot 을 보고 띄운다.

| node | 이 구간에서 하는 일 | 안 하는 일 |
|---|---|---|
| interface | 사용자 대화 · grill · 결정 기록 · raw→task 승격 · `needs:user` 중계. orchestration(spawn · 리뷰 큐 · 머지) 겸무 가능 — 조건은 [interface](../interface/memory.md) §3 | 코드 수정 — 쓰기 범위는 [interface](../interface/memory.md) §4 |
| orchestrator | label 을 보고 다음 node spawn (`.agents/prompts/orchestrator.md` 그대로 기동) | 판단. 사용자와 대화하지 않는다. 코멘트를 읽지 않는다 |
| 구현자 | 커밋 · 푸시 · PR 생성 · 수정 라운드의 blocking 반영. **저자 사본에 파일을 쓰는 유일한 역할** | 리뷰어 부착, 라운드 판정, 머지, scorecard 의 non-blocking 수리 |
| 리뷰어 | 판정 + scorecard + verdict label. 라운드 3부터는 회고 모드 — 개별 지적 대신 유형 반복 표 | commit / push / merge / branch 수정, 이슈 발행 |
| 종결자 | 머지 · 브랜치 삭제 · 사본 회수 · 이슈 종결. 대규모 삭제 머지 시 삭제 경로 참조 이슈 스윕 | 코드 수정 |

**non-blocking 은 구현자의 수정 라운드 작업이 아니다** — 그 행선지는 scorecard
기록이고, 이슈화는 [interface](../interface/memory.md) §2 가 소유한다.

**저자가 자기 판정을 하지 않는다** — 자기 PR 의 리뷰어를 부르는 것, 자기가 고친
것을 재발로 재단하는 것, 자기 PR 을 머지하는 것 셋 다 다른 node 로 나갔다.

## 자율 실행 vs 중단

자율 진행이 기본. 다음 중단 조건 도달 시 즉시 멈추고 사용자에게 원인 보고:

- `git push --force` / `--force-with-lease`: agent path 에서 수행 금지
  ([git-policy](../git-policy/memory.md)).
- main 직접 push (PR 우회).
- 머지 방식이 아래 기본값과 다르게 지시됐을 때 — 종결자가 사용자에게 확인.
- 라운드 회고 트리거(라운드 3 이상 / 유형 재발 / 리뷰어 사이클 보고) — 구현자는
  같은 유형에 fix 를 더 쌓지 말고 종료한다. **이 셋은 회고 모드로 들어가는 조건이지
  작업을 정지시키는 조건이 아니다** — 정지는 회고 모드 리뷰어가
  [orchestration](../orchestration/memory.md) §3 으로 판정할 때만 걸리고, 그 요구가
  없으면 다음 라운드는 수정 라운드로 재개한다. 재설계는 interface 를 거쳐 사용자가
  한다(`reflect:done` label).
  **「유형 재발」은 [orchestration](../orchestration/memory.md) §3 의 트리거 둘을
  가리키고 구현자가 scorecard 를 읽어 스스로 재단하지 않는다** — k 에 없던 blocking 이
  k+1 에 생겼거나, k+1 에도 blocking 이 있는데 k 의 것이 하나도 안 없어졌을 때다.
  라운드 2 이상 scorecard 가 싣는 직전 라운드와의 blocking
  대조([review](../review/memory.md) 「행동 계약」)에서 직전 라운드 blocking 중 없어진
  것이 하나라도 있으면 「둘 다에 있는 것」이 남아 있어도 그 트리거가 아니다 — 남은
  blocking 을 보는 §3 트리거는 k 의 것이 하나도 안 없어졌을 때 걸린다. 새로 생긴
  blocking 을 보는 쪽은 그 칸이 아니라 k+1 에만 있는 blocking 이 정한다.
  단 verdict 가 green 이면 중단이 아니다 — 라운드 3 이상이어도 종결자가
  `reflect:done` 붙이고 머지한다. 게이트 진단은
  [diagnosing-merge-gates](../../../.agents/skills/diagnosing-merge-gates/SKILL.md),
  required context 목록은
  [runbook/pr-merge-gates](../../runbook/pr-merge-gates/memory.md).
- 사용자 명시 거부("commit 하지 마", "push 멈춰") — 즉시 중단.

머지 자율 조건(정성 차원에 blocking 없음, CI SUCCESS + `review:approved`, 서로 다른
head OID 로 센 라운드가 3 이상이면 `reflect:done` 까지, mergeable, 사용자 거부 없음)은
종결자가 종합한다.

**머지 방식은 squash 가 기본값이다.** 사본 회수의 head-OID 대조와 브랜치 삭제
흐름이 squash 를 전제하고([worktree](../../runbook/worktree/memory.md) 「회수」),
2026-07-30 재건 이후 머지 9건이 전부 squash 였다 — 각 머지 SHA 의 부모가 1개다
(`git rev-list --parents -n1 <sha>`). 다른 방식은 사용자 명시 지시가 있을 때만.

## 검증 — 절대 회피 금지

- `--no-verify` / `--no-gpg-sign` 금지 ([git-policy](../git-policy/memory.md)).
- CI 실패 시 회피 X, 근본 원인 fix.
- GPG signing pinentry timeout 시 즉시 중단. unsigned commit 으로 진행하지 않음.
- RED evidence 는 [tdd](../tdd/memory.md) 의 권고이지 통과 조건이 아니다.

## PR body

PR 이 남기는 산출물(PR body · squash 커밋 메시지 · scorecard)의 작성 규칙은
[pr-artifacts](../pr-artifacts/memory.md) 가 소유한다. 이 절은 그 방이 갈라져 나간
뒤에도 이 자리를 가리키던 경로(CI 주석 · 스크립트 주석)가 끊기지 않게 두는
포인터다.

## Agent spawn — reviewer 독립

self-review 는 편향. 독립 리뷰 coordinator 를 spawn 해 평가한다 — 저자가
부르지 않는다. [review](../review/memory.md) 행동 계약 적용.
외부 시각은 사용자가 명시할 때만 추가한다. 작업 사본(clone)은 PR 당 하나이고
동시에 쓰는 node 는 하나다 — 라운드마다 새로 만들지 않는다
([worktree](../../runbook/worktree/memory.md)).

## Why

사용자 2026-05-16 강하게 lock — "커밋 왜 자꾸 나한테 하라고 지랄이야". 이전 패턴
(assistant = 변경 요약만 보고) retire. 사용자는 작업 완전 종료까지 책임지길 원함.

## Sync 책임

각 step 끝나면 1줄 보고 (PR URL / merge SHA 등).
[implementation](../implementation/memory.md) 의 noise 차단 룰 정합 — 결과만,
narration 없음.

## 관련

- [interface](../interface/memory.md) — 사용자 대화 전담 · raw→task 승격
- [git-policy](../git-policy/memory.md) — `--no-verify` / force-push 금지 (집행 장치 없음)
- [review](../review/memory.md) — 리뷰 단계 행동 계약
- [pr-artifacts](../pr-artifacts/memory.md) — PR 산출물(PR body · squash 커밋 메시지 · scorecard) 작성 규칙
- [documentation](../documentation/memory.md) — 문서화 impact + evidence portability
- [tdd](../tdd/memory.md) — code-profile sprint RED evidence
- [engineering/conventions](../../engineering/conventions/memory.md) — Conventional Commits 형식
