---
title: Delivery — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 행동 계약
type: workflow-rule
updated: 2026-07-29
task: delivery, commit, push, pr, review, merge
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
| orchestrator | label 을 보고 다음 node spawn, 사용자 창구 | 판단. 코멘트를 읽지 않는다 |
| 구현자 | 커밋 · 푸시 · PR 생성 · 수정 라운드 반영. **파일을 쓰는 유일한 역할** | 리뷰어 부착, 라운드 판정, 머지 |
| 리뷰어 | 판정 + scorecard + verdict label | commit / push / merge / branch 수정 |
| 회고자 | 라운드 3부터 개별 지적이 아니라 유형 반복을 본다 | 코드 수정 |
| 종결자 | 머지 · 브랜치 삭제 · worktree 회수 · 이슈 종결 | 코드 수정 |

**저자가 자기 판정을 하지 않는다** — 자기 PR 의 리뷰어를 부르는 것, 자기가 고친
것을 재발로 재단하는 것, 자기 PR 을 머지하는 것 셋 다 다른 node 로 나갔다.

## 자율 실행 vs 중단

자율 진행이 기본. 다음 중단 조건 도달 시 즉시 멈추고 사용자에게 원인 보고:

- `git push --force` / `--force-with-lease`: agent path 에서 수행 금지
  ([git-policy](../git-policy/memory.md)).
- main 직접 push (PR 우회).
- `gh pr merge` 의 squash/merge/rebase 정책이 명시 안 됐을 때 — 종결자.
- 라운드 회고 트리거(라운드 3 이상 / 유형 재발 / 리뷰어 사이클 보고) — 구현자는
  같은 유형에 fix 를 더 쌓지 말고 종료한다. 판정은 회고자가, 재설계는 사용자가
  한다(`reflect:done` label). 단 verdict 가 green 이면 중단이 아니다 — 라운드 3
  이상이어도 종결자가 `reflect:done` 붙이고 머지한다. 게이트 진단은
  [runbook/pr-merge-gates](../../runbook/pr-merge-gates/memory.md).
- 사용자 명시 거부("commit 하지 마", "push 멈춰") — 즉시 중단.

머지 자율 조건(정성 차원에 blocking 없음, CI SUCCESS + `review:approved`,
mergeable, 사용자 거부 없음)은 종결자가 종합한다.

## 검증 — 절대 회피 금지

- `--no-verify` / `--no-gpg-sign` 금지 ([git-policy](../git-policy/memory.md)).
- CI 실패 시 회피 X, 근본 원인 fix.
- GPG signing pinentry timeout 시 즉시 중단. unsigned commit 으로 진행하지 않음.
- RED evidence 는 [tdd](../tdd/memory.md) 의 권고이지 통과 조건이 아니다.

## PR body

형식 요구는 없다. 유일한 제약은 근거의 이식성 — PR body / comment 는 GitHub 에서
열리는 repo-relative path 와 URL 만 쓴다. `/Users`, `/tmp`, `file://`,
`worktrees/` 금지. 문서화 판단은 [documentation](../documentation/memory.md).

## Agent spawn — reviewer 독립

self-review 는 편향. 독립 리뷰 coordinator 를 spawn 해 평가한다 — 저자가
부르지 않는다. [review](../review/memory.md) 행동 계약 적용.
외부 시각은 사용자가 명시할 때만 추가한다. worktree 는 PR 당 하나이고
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

- [git-policy](../git-policy/memory.md) — `--no-verify` / force-push 금지 (집행 장치 없음)
- [review](../review/memory.md) — 리뷰 단계 행동 계약
- [documentation](../documentation/memory.md) — 문서화 impact + evidence portability
- [tdd](../tdd/memory.md) — code-profile sprint RED evidence
- [engineering/conventions](../../engineering/conventions/memory.md) — Conventional Commits 형식
