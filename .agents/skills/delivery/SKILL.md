---
name: delivery
description: 구현자가 변경을 커밋하고 푸시하고 PR 을 여는 절차. 커밋 형식 · SHA refspec push · PR body 게이트 · 멈추는 자리가 여기 있고, PR 본문 조립은 pr-create skill 이 소유한다. 리뷰 부착 · 라운드 판정 · 머지는 이 절차 밖이다.
---

# 배송 — 구현자 절차

구현이 끝나면 구현자(`issue-implement`)가 **커밋 → 푸시 → PR 생성** 까지 자율
실행하고, 결과를 남기고 죽는다. 사용자에게 "이제 커밋해 주세요" 안내 금지.

절차는 PR 생성에서 끝난다. 리뷰어를 붙이는 일, 라운드를 재는 일, 머지, 브랜치와
worktree 회수는 다른 node 가 하고 orchestrator 가 label 을 보고 띄운다. 저자가 자기
PR 의 리뷰어를 부르거나 자기가 고친 것을 자기가 재발로 판정하지 않게 하는 것이 이
분리의 목적이다.

행동 계약(멈추는 자리 / why)은 `memory/workflow/delivery/memory.md` 가 소유하고, PR
본문 조립 방법론은 `pr-create` skill 이 소유하므로 여기서 재서술하지 않고 참조만
한다.

## Inputs

1. 완료된 구현 diff + 실행한 정량 check(test/lint/typecheck) 결과.
2. branch / worktree 상태(SHA refspec push 대비 `git rev-parse HEAD`).
3. sprint contract(있으면 `docs/sprints/sprint-<N>/contract.md` — `review-profile`).
4. 관련 active memory / docs.

## 절차

각 step 은 hook 통과가 전제 — 회피하지 않고 실패는 근본 fix.

1. **변경 커밋** — `git add <특정 파일>` + `git commit -m "..."`. pre-commit hook
   통과 책임. Conventional Commits 형식(`feat(scope): description`).
2. **브랜치 푸시** — SHA refspec push: `git rev-parse HEAD` →
   `git push origin '<literal-sha>':'refs/heads/<branch>'`. pre-push stage 통과.
   `sprint-N/*` branch contract 가 `review-profile: code` 면 push 전
   [tdd](../../../memory/workflow/tdd/memory.md) 의 RED evidence 를 확인한다.
3. **PR 생성** — `pr-create` skill (`.agents/skills/pr-create/SKILL.md`) 적용:
   `.github/PULL_REQUEST_TEMPLATE.md` 기반 body 조립 + `check-pr-body.mjs` 로컬
   검증 → PASS 시 `gh pr create`. push 전 통과로 CI re-push 낭비 차단.
4. **PR URL 보고 후 종료** — 리뷰는 독립 `pr-reviewer` coordinator 가 본다(self-review
   는 편향). 그 부착 시점은 `memory/workflow/review/memory.md` 가 정한다.
   `gh pr create` 직후의 PostToolUse 리마인더
   (`scripts/hooks/apply/pr-create-reminder.sh`)가 그 단계를 상기시킨다 — block 아님.

## 수정 라운드

`review:changes-requested` 를 받은 PR 에 다시 붙는 구현자의 절차다.

- 라운드 단위는 commit 이 아니라 push 다 (`review-gate` 가 synchronize 마다 승인
  해제) — 한 라운드의 fix 를 전부 반영한 뒤 한 번만 push 한다.
- **PR 에 comment 를 남기지 않는다** — `review-gate` 가 PR comment 수로 라운드를
  세므로 fix 보고가 라운드로 세어져 실제보다 일찍 막힌다. 상태는 commit 메시지와
  PR body 로 말한다.
- 리뷰어가 전수 명령을 첨부했으면 그 출력이 0 이 될 때까지 고치고 출력을 증거로
  낸다(pr-review 원칙 2). 인용된 줄만 고치면 같은 파일의 잔여가 다음 라운드에 다시
  red 로 온다.
- 재리뷰 범위는 이전 라운드 blocking 의 해소 여부다(원칙 3).

**멈추는 자리** — 아래는 구현자가 판정하지 않는다. fix 를 더 쌓지 말고 종료하면
orchestrator 가 라운드 회고(`round-reflect`) 또는 사용자에게 넘긴다.

- 라운드 3 이상 — `review-gate` 가 `comments >= 3` 으로 센다.
- 이전 라운드에서 고친 유형이 다시 나옴.
- 리뷰어가 verdict 대신 사이클을 보고(pr-review 원칙 3).

`reflect:done` 은 라운드 3 이상 PR 의 머지를 여는 label 이다. green 이면
종결자(`pr-finalize`)가, red 면 사용자의 재설계 판단 뒤에 붙는다. **구현자는 붙이지
않는다.**

## Boundaries

- 즉시 중단·보고: agent path 의 `git push --force` / `--force-with-lease`, main 직접
  push, 사용자 명시 거부("commit 하지 마" 등).
- hook 회피 금지: `--no-verify` / `--no-gpg-sign` / `LEFTHOOK=0` 등
  (`.claude/rules/git-policy.md`). hook 실패는 근본 fix. GPG signing pinentry
  timeout 시 즉시 중단, unsigned commit 으로 진행하지 않는다.
- **파일을 쓰는 역할은 구현자뿐이다.** 리뷰어는 read-only — commit / push / merge /
  branch 수정 금지. 한 worktree 에 동시에 쓰는 node 는 하나다.
- 머지하지 않는다. 자율 머지 조건과 게이트 진단은 종결자 몫이고 SOT 는
  `memory/runbook/pr-merge-gates/memory.md` — 여기 복제 금지.
- 각 step 후 1줄 결과 보고(PR URL 등). narration 없음.
- PR body / comment 는 GitHub 에서 보이는 repo-relative path / URL 만
  ([documentation](../../../memory/workflow/documentation/memory.md)).

## Related

- `memory/workflow/delivery/memory.md` — 배송 phase 의 node 별 행동 계약
- `.agents/skills/pr-create/SKILL.md` — PR 생성 방법론(중복 서술 금지)
- `.agents/skills/pr-review/SKILL.md` — 리뷰 방법론
- `.claude/rules/git-policy.md` — hook / signing 회피 금지 + SHA refspec push
- `memory/workflow/tdd/memory.md` — code-profile sprint RED evidence
- `memory/runbook/pr-merge-gates/memory.md` — merge gate 진단
- `memory/workflow/documentation/memory.md` — PR body gate
