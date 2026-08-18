---
title: Delivery — 커밋 → 푸시 → PR → 리뷰 → 머지 구간의 node 별 행동 계약
type: workflow-rule
updated: 2026-08-17
task: delivery, commit, push, pr, review, merge
keywords: 커밋, commit, push, PR 생성, squash, squash body, squash 제목, 머지 제목, 교정 대상 표면, --body-file, --subject, COMMIT_MESSAGES, COMMIT_OR_PR_TITLE, 뒤집힌 주장, 철회문, scorecard 대조, staleness, 머지 정책, review:approved, reflect:done, 자율 실행, 중단 조건, 회고 모드 진입 조건, GPG, pinentry, 노드 표
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

형식 요구는 없다. CI 가 집행하는 제약은 근거의 이식성 · 전칭 서술의 반증 명령 ·
분량이다.
**이식성** — PR body / comment 는 GitHub 에서 열리는 repo-relative path 와 URL 만
쓴다. `/Users`, `/tmp`, `file://`, `worktrees/`, `clones/` 금지.
**분량** — body 한 벌이 12,000 문자 이하다 (#2321). 집행은
`scripts/check-review-size-cap.sh` 이고 판정 정의와 그 수의 출처는 그 헤더가 갖는다 —
같은 cap 이 scorecard 에도 장 단위로 걸리고 그쪽 자리는 [review](../review/memory.md)
「행동 계약」이다. **전칭** — 트리거
낱말이 든 줄은 ±6 줄 안에 명령을 갖고 있어야 한다 (#2228). 낱말 목록과 「±6」의 뜻은
`scripts/check-pr-body-universals.sh` 헤더가 소유하니 여기 옮겨 적지 않는다 — 규칙
자체의 SOT 는 [implementation](../implementation/memory.md) §5 다. 그 검사는 낱말
옆에 명령이 있는지만 보고 주장의 참·거짓은 안 본다.
문서화 판단은 [documentation](../documentation/memory.md).

2026-07-31 부터 PR body 는 CI 가 실제로 검사한다 — `PR Body Contract` job 이
`/Users/` · `/tmp/` · `file://` · `worktrees/` · `clones/` 를 찾으면 fail 이다
(빈 body 는 pass). 게이트라 **금지 패턴을 인용만 해도 걸린다** — 예시를 들 때는
문자열을 쪼개거나 이름으로 부르고 그대로 붙이지 마라. 해소는 새 commit 뿐이다
(body 편집으로는 재검사되지 않음 — [pr-merge-gates](../../runbook/pr-merge-gates/memory.md)).

**diff 계열 명령은 움직이는 ref 가 아니라 `"$(git merge-base origin/main HEAD)"` 에
앵커한다** — body · 이슈 · 커밋 메시지 어디든 같고, `--stat` · `--name-only` ·
삽입/삭제 줄 수가 걸린다 (rev 를 명시하는 `git grep <rev>` 류는 해당 없다).
`origin/main` 기준으로 재면 저자가 push 한 뒤 남의 PR 이 머지되는 것만으로
**저자 귀책 없이** 값이 바뀐다 — 브랜치가 손도 안 댄 파일이라도 그 파일에서
브랜치가 main 보다 뒤처져 있으면 그 diff 에 섞여 든다. 병렬 PR 이 도는 저장소라
push 와 리뷰 사이에 main 이 움직이고, 실물은 이슈 #2260 이 PR #2259 로 기록해 뒀다.
**검사하는 기계는 없다.**

**PR body 와 squash 커밋 메시지는 다음 노드가 읽는 입력이다** — 노드는 죽고 산출물만
남으니 거짓이거나 낡아진 주장은 미래 구현자·디버깅 세션의 거짓 전제가 된다 (정량 주장에
재현 명령을 붙이는 제약은 [implementation](../implementation/memory.md) §5 표가 SOT).
수정 라운드에서 낡은 주장은 **지우는 것이 기본**이다 — 그 라운드가 새로 쓰는 줄은
정의상 지난 라운드 검증 집합 밖이라, 고쳐 쓴 문장이 다음 라운드에 반증되는 것이
blocking 의 반복 공급원이었다 (#2226). 다시 쓰는 것은 지우면 정보가 사라질 때뿐이고,
그때는 추론이 아니라 명령 출력으로 쓴다 (같은 §5 표의 「수치가 추론으로 생산됨」 행).
지우든 다시 쓰든 body 편집 단독은 재검사되지 않으니 fix commit + push 와 한 세트로 간다.

### squash 커밋 교정 — 표면은 제목과 body 둘이다

**squash 가 main 히스토리에 남기는 표면은 둘이고 어느 쪽도 PR body 가 아니다.**
한쪽만 교정하면 다른 쪽으로 거짓이 그대로 나간다.

| 표면 | 무엇이 오나 | 저자가 고칠 수 있나 | 종결자의 교정 지점 |
|---|---|---|---|
| 제목 | 커밋이 하나면 그 커밋 제목, 둘 이상이면 PR 제목 (`squash_merge_commit_title=COMMIT_OR_PR_TITLE`) | 커밋 하나면 못 고친다 · 둘 이상이면 `gh pr edit --title` | `--subject` |
| body | 브랜치 커밋 메시지를 이어붙인 것 (`squash_merge_commit_message=COMMIT_MESSAGES`) | 못 고친다 | `--body-file` |

저자가 못 고치는 칸의 사유는 하나다 — force-push 가
[git-policy](../git-policy/memory.md) hard block 이라 push 된 커밋 메시지가 그대로
간다. 리뷰가 소스와 PR body 를 고쳐도 두 표면은 거짓인 채다. 머지 뒤에는 양쪽 다
히스토리라 아무도 못 고친다. **제목 쪽 실물이 2026-08-11 #2286 이다** — 리뷰가
교정 대상으로 지목한 닫힌 개수 서술을 제목이 이고 있었고 `--body-file` 이 안 닿는
자리였다. 그때 안 샌 것은 이 계약이 아니라 그 종결자의 재량 덕이다.

**교정 대상은 리뷰 라운드가 뒤집은 모든 주장이고 두 표면에 똑같이 걸린다 — 수치 ·
산문 · 철회된 결론.**
수치로만 좁히면 수치가 아닌 거짓이 조건에 안 걸린다. 2026-08-07 #2204 가 그
형태다 — 저자의 철회 목록이 같은 줄의 `182 → 183` 은 고치고 `the two new tests` 라는
**낱말**은 안 건드렸는데, 브랜치가 더한 테스트는 셋이었다 (라운드 2 scorecard NB2).
저자의 철회문도 주장이라 같이 본다 — 저자가 자기 거짓을 세는 구조라 목록이 빠지거나
철회문 자체가 거짓일 수 있다 (2026-08-07 #2206 라운드 2 scorecard non-blocking 3:
철회문이 "base 와 head 에서 똑같이 0건" 이라 적었는데 base 는 2건이었다).

**종결자는 무엇이 거짓인지 새로 판정하지 않는다** — 리뷰어가 이미 판정한 것을 위 두
표면에서 찾는다. **리뷰어가 안 지목한 것은 제목에서도 안 고친다.** 커밋 하나짜리
PR 의 착지 제목이 PR 제목에 있던 `(#이슈)` 를 잃는 것이 그 형태인데, 제목 형식의
SOT 는 [engineering/conventions](../../engineering/conventions/memory.md)
「커밋 메시지」이고 거기에 이슈 번호를 요구하는 줄이 없어 종결자가 새로 재단할
자리가 아니다. **닫는 것은 종결자가 아니라 저자다** — 커밋 제목에
`(#이슈)` 를 넣거나, 커밋을 하나 더 얹어 제목 출처를 자기가 `gh pr edit --title` 로
고칠 수 있는 PR 제목 쪽으로 넘긴다.
**커밋이 하나여도 대조를 통째로 건너뛰지 않는다** — 라운드 1 의
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
