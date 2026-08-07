---
title: Delivery — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 행동 계약
type: workflow-rule
updated: 2026-08-07
task: delivery, commit, push, pr, review, merge
keywords: 커밋, commit, push, PR 생성, squash, squash body, --body-file, COMMIT_MESSAGES, 뒤집힌 주장, 철회문, scorecard 대조, staleness, 머지 정책, review:approved, reflect:done, 자율 실행, 중단 조건, GPG, pinentry, 노드 표
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
| 구현자 | 커밋 · 푸시 · PR 생성 · 수정 라운드 반영. **저자 사본에 파일을 쓰는 유일한 역할** | 리뷰어 부착, 라운드 판정, 머지 |
| 리뷰어 | 판정 + scorecard + verdict label. 라운드 3부터는 회고 모드 — 개별 지적 대신 유형 반복 표 | commit / push / merge / branch 수정, 이슈 발행 |
| 종결자 | 머지 · 브랜치 삭제 · 사본 회수 · 이슈 종결. 대규모 삭제 머지 시 삭제 경로 참조 이슈 스윕 | 코드 수정 |

**저자가 자기 판정을 하지 않는다** — 자기 PR 의 리뷰어를 부르는 것, 자기가 고친
것을 재발로 재단하는 것, 자기 PR 을 머지하는 것 셋 다 다른 node 로 나갔다.

## 자율 실행 vs 중단

자율 진행이 기본. 다음 중단 조건 도달 시 즉시 멈추고 사용자에게 원인 보고:

- `git push --force` / `--force-with-lease`: agent path 에서 수행 금지
  ([git-policy](../git-policy/memory.md)).
- main 직접 push (PR 우회).
- 머지 방식이 아래 기본값과 다르게 지시됐을 때 — 종결자가 사용자에게 확인.
- 라운드 회고 트리거(라운드 3 이상 / 유형 재발 / 리뷰어 사이클 보고) — 구현자는
  같은 유형에 fix 를 더 쌓지 말고 종료한다. 판정은 회고 모드 리뷰어가,
  재설계는 interface 를 거쳐 사용자가 한다(`reflect:done` label). 단 verdict 가 green 이면 중단이 아니다 — 라운드 3
  이상이어도 종결자가 `reflect:done` 붙이고 머지한다. 게이트 진단은
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

형식 요구는 없다. CI 가 집행하는 유일한 제약은 근거의 이식성 — PR body / comment 는
GitHub 에서 열리는 repo-relative path 와 URL 만 쓴다. `/Users`, `/tmp`, `file://`,
`worktrees/`, `clones/` 금지. 문서화 판단은 [documentation](../documentation/memory.md).

2026-07-31 부터 PR body 는 CI 가 실제로 검사한다 — `PR Body Contract` job 이
`/Users/` · `/tmp/` · `file://` · `worktrees/` · `clones/` 를 찾으면 fail 이다
(빈 body 는 pass). 게이트라 **금지 패턴을 인용만 해도 걸린다** — 예시를 들 때는
문자열을 쪼개거나 이름으로 부르고 그대로 붙이지 마라. 해소는 새 commit 뿐이다
(body 편집으로는 재검사되지 않음 — [pr-merge-gates](../../runbook/pr-merge-gates/memory.md)).

**PR body 와 squash 커밋 메시지는 다음 노드가 읽는 입력이다** — 노드는 죽고 산출물만
남으니 거짓이거나 낡아진 주장은 미래 구현자·디버깅 세션의 거짓 전제가 된다 (정량 주장에
재현 명령을 붙이는 제약은 [implementation](../implementation/memory.md) §5 표가 SOT).
수정 라운드에서 코드가 바뀌어 body 의 기존 주장이 낡으면 fix commit 과 같은 턴에
body 도 갱신한다 — body 편집 단독은 재검사되지 않으니 commit + push 와 한 세트로 간다.

### squash body 교정

기본 squash body 는 PR body 가 아니라 **브랜치 커밋 메시지를 이어붙인 것이다**
(repo 설정 `squash_merge_commit_message=COMMIT_MESSAGES`). 저자는 이미 push 된 커밋
메시지를 못 고친다 — force-push 가 [git-policy](../git-policy/memory.md) hard block
이라, 리뷰가 소스와 PR body 를 고쳐도 커밋 메시지는 거짓인 채로 남는다. 교정 지점은
종결자의 `--body-file` 하나뿐이고 머지 뒤에는 히스토리라 아무도 못 고친다.

**교정 대상은 리뷰 라운드가 뒤집은 모든 주장이다 — 수치 · 산문 · 철회된 결론.**
수치로만 좁히면 수치가 아닌 거짓이 조건에 안 걸린다. 2026-08-07 #2204 가 그
형태다 — 저자의 철회 목록이 같은 줄의 `182 → 183` 은 고치고 `the two new tests` 라는
**낱말**은 안 건드렸는데, 브랜치가 더한 테스트는 셋이었다 (라운드 2 scorecard NB2).
저자의 철회문도 주장이라 같이 본다 — 저자가 자기 거짓을 세는 구조라 목록이 빠지거나
철회문 자체가 거짓일 수 있다 (2026-08-07 #2206 라운드 2 scorecard non-blocking 3:
철회문이 "base 와 head 에서 똑같이 0건" 이라 적었는데 base 는 2건이었다).

**종결자는 무엇이 거짓인지 새로 판정하지 않는다** — 리뷰어가 이미 판정한 것을
커밋 메시지와 대조한다. **커밋이 하나여도 대조를 통째로 건너뛰지 않는다** — 라운드 1 의
finding 이 그 하나뿐인 커밋 메시지를 지목할 수 있고, non-blocking 만 달고 라운드 1 에서
approved 되면 커밋이 둘로 늘지 않은 채 머지된다. 싼 경로는 대조 범위를 라운드 1
scorecard 하나로 줄이는 것이지 생략이 아니다. 대조 절차는
[pr-finalize preamble](../../../.agents/prompts/pr-finalize.md) 「3단계」가 갖는다.
교정본에도 위 정량 주장 제약이 그대로 걸린다 (2026-07-31 PR #2023: 커밋 606c426e 의
통과 수치가 작성 뒤 스위트 확장으로 낡아, 종결자가 교정본으로 머지했다 — 2007be88).

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
- [documentation](../documentation/memory.md) — 문서화 impact + evidence portability
- [tdd](../tdd/memory.md) — code-profile sprint RED evidence
- [engineering/conventions](../../engineering/conventions/memory.md) — Conventional Commits 형식
