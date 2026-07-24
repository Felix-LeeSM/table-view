---
name: delivery
description: 구현 완료 후 commit→push→PR→review→merge→cleanup 파이프라인을 자율 오케스트레이션할 때 사용. T0~T7 절차를 순서대로 실행하고 T3는 pr-create, T4는 pr-review skill에 위임한다. 중단 조건 도달 시 사용자에게 보고.
---

# Delivery

구현이 끝나면 delivery owner 가 commit→push→PR→review→merge→cleanup 을 자율
실행한다. 사용자에게 "이제 커밋해 주세요" 안내 금지. 이 skill 은 그 파이프라인의
T0~T7 오케스트레이션 절차 SOT 다. 행동 계약(ownership / 중단 조건 / why)은
`memory/workflow/delivery/memory.md` 가 소유하고, T3(PR 생성)·T4(review)의 방법론은
각각 `pr-create`·`pr-review` skill 이 소유하므로 여기서 재서술하지 않고 참조만 한다.

## Inputs

1. 완료된 구현 diff + 실행한 정량 check(test/lint/typecheck) 결과.
2. branch / worktree 상태(SHA refspec push 대비 `git rev-parse HEAD`).
3. sprint contract(있으면 `docs/sprints/sprint-<N>/contract.md` — `review-profile`).
4. 관련 active memory / docs.

## Pipeline (T0~T7)

작업 종료 시 아래를 순서대로 자율 실행. 각 step 은 hook 통과가 전제 —
회피하지 않고 실패는 근본 fix.

1. **T1 Commit** — `git add <특정 파일>` + `git commit -m "..."`. pre-commit hook
   통과 책임. Conventional Commits 형식(`feat(scope): description`).
2. **T2 Push** — SHA refspec push: `git rev-parse HEAD` →
   `git push origin '<literal-sha>':'refs/heads/<branch>'`. pre-push stage 통과.
   `sprint-N/*` branch contract 가 `review-profile: code` 면 push 전
   [tdd](../../../memory/workflow/tdd/memory.md) 의 RED evidence 를 확인한다.
3. **T3 PR** — `pr-create` skill (`.agents/skills/pr-create/SKILL.md`) 적용:
   `.github/PULL_REQUEST_TEMPLATE.md` 기반 body 조립 + `check-pr-body.mjs` 로컬
   검증 → PASS 시 `gh pr create`. push 전 통과로 CI re-push 낭비 차단.
4. **T4 Review** — `pr-reviewer` coordinator 1회 spawn(default 자동, 무-게이트):
   - 정량은 자동 layer(hook / lint / pre-push / `scripts/review/run-checks.sh`)가
     이미 수행. reviewer 는 재실행하지 않는다.
   - `pr-reviewer` 는 `.agents/skills/pr-review/SKILL.md` 를 적용하고 필요 시
     관점별 read-only `pr-subreviewer` 를 fan-out.
   - self-review 는 편향 → 독립 reviewer 가 본다.
   - 출력: PR 에 직접 남긴 통합 scorecard comment + verdict label
     (green → `review:approved`, red → `review:changes-requested`).
   - soft backstop: `gh pr create` 직후 PostToolUse 리마인더 훅
     (`scripts/hooks/pr-create-reminder.sh`)이 이 단계를 상기시킨다. block 아님.
   - 외부 옵션: 사용자가 "codex 리뷰도 받아" → `codex-reviewer` 추가(자동 X).
5. **T5 Reflect/Fix** — 결함 발견 시 delivery owner 가 fix commit + push → T4
   재시작. push(synchronize)는 `review-gate` 가 `review:approved` 를 자동 해제 —
   재리뷰 필수.
6. **T6 Merge or Blocked report** — 자율 머지 조건 모두 충족 시
   `gh pr merge --squash --delete-branch` 자율 실행:
   - 정성 모든 차원 ≥ 8/10
   - `gh pr checks` SUCCESS (`review-gate` 는 reviewer 의 `review:approved` label
     필요, main required check + enforce_admins 라 우회 불가)
   - `gh pr view` mergeable 이고 branch policy block 없음
   - 사용자 명시 거부 없음
   조건 미달 시 원인(PR conflict / CI / policy / review)을 사용자에게 보고.
   mergeable 인데 BLOCKED / "base branch policy" 로 막히면
   [runbook/pr-merge-gates](../../../memory/runbook/pr-merge-gates/memory.md) 진단 —
   required 는 review-gate + E2E `Runtime Happy Path` 이중, UNSTABLE 은 merge 가능,
   트리거 반복 금지.
7. **T7 Cleanup** — merge / blocked 이후 agent close + worktree cleanup, 또는
   보존 사유 기록.

## Boundaries

- 중단 조건(사용자 확인 / 별도 절차 필요) 도달 시 즉시 중단·보고: agent path 의
  `git push --force` / `--force-with-lease`, main 직접 push, `gh pr merge` 의
  squash/merge/rebase 정책 미명시, 사용자 명시 거부("commit 하지 마" 등).
- hook 회피 금지: `--no-verify` / `--no-gpg-sign` / `LEFTHOOK=0` 등
  (`.claude/rules/git-policy.md`). hook 실패는 근본 fix. GPG signing pinentry
  timeout 시 즉시 중단, unsigned commit 으로 진행하지 않는다.
- reviewer 는 read-only — commit / push / merge / branch 수정 금지. delivery owner
  만 소유하고, 한 PR 의 delivery owner 는 1명(fix 는 같은 owner 에게 되돌린다).
- 각 step 후 1줄 결과 보고(PR URL / merge SHA 등). narration 없음.
- PR body / comment 는 GitHub 에서 보이는 repo-relative path / URL 만
  ([documentation](../../../memory/workflow/documentation/memory.md)).

## Related

- `memory/workflow/delivery/memory.md` — delivery 행동 계약(ownership / 중단 / why)
- `.agents/skills/pr-create/SKILL.md` — T3 PR 생성 방법론(중복 서술 금지)
- `.agents/skills/pr-review/SKILL.md` — T4 review 방법론
- `.claude/rules/git-policy.md` — hook / signing 회피 금지 + SHA refspec push
- `memory/workflow/tdd/memory.md` — code-profile sprint RED evidence
- `memory/runbook/pr-merge-gates/memory.md` — merge gate 진단
- `memory/workflow/documentation/memory.md` — PR body gate
