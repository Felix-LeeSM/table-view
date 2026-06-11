---
title: Delivery — commit → push → PR → review → merge 전체 자율
type: workflow-rule
updated: 2026-06-12
task: delivery, commit, push, pr, review, merge
trigger:
  signal: implementation 완료 / 사용자가 "마무리해" / sprint 종료
  layer: agent-prompt (delivery agent)
---

# Delivery — commit → push → PR → review → merge 전체 자율

작업 종료 시 agent 가 다음 pipeline 을 자율 실행. 사용자에게 "이제 커밋해 주세요" 안내 금지.

## Ownership

- **orchestrator**: task 정의, worktree/agent 상태 추적, blocker 보고.
- **delivery owner**: 구현/commit/push/PR/review 반영/merge/cleanup 소유.
- **pr-reviewer**: read-only 판단자. commit / push / merge 금지.

한 PR 에 delivery owner 는 1명. review finding fix 는 같은 owner 에게 되돌려
reflect 시킨다. 실패 worker 를 계속 새로 쌓지 않음.

## Pipeline (T0~T7)

1. **T1 Commit** — `git add <specific files>` + `git commit -m "..."`. pre-commit hook 통과 책임.
2. **T2 Push** — `git push`. pre-push stage 통과. `sprint-N/*` branch 의 contract 가 `review-profile: code` 면 [tdd](../tdd/memory.md) 의 RED evidence 를 push 전 확인한다.
3. **T3 PR** — `gh pr create`. body 는 Summary / Changes / Invariants / Test plan / Smoke impact / Documentation impact / Links.
4. **T4 Review** — `pr-reviewer` coordinator spawn (1회, default 자동):
   - 정량은 자동 layer (hook / lint / pre-push / scripts/review/run-checks.sh) 가 이미 함
   - pr-reviewer 는 `.agents/skills/pr-review/SKILL.md` 를 적용하고 필요 시
     관점별 read-only `pr-subreviewer` 를 fan-out
   - 출력: PR에 직접 남긴 통합 scorecard comment
   - **외부 옵션**: 사용자가 "codex 리뷰도 받아" → `codex-reviewer` 추가
5. **T5 Reflect/Fix** — 결함 발견 시 delivery owner 가 fix commit + push → T4 재시작
6. **T6 Merge or Blocked report** — 자율 머지 조건:
   - 정성 모든 차원 ≥ 8/10
   - `gh pr checks` SUCCESS (CI green)
   - `gh pr view` 가 mergeable 이고 branch policy block 없음
   - 사용자 명시 거부 없음
     → `gh pr merge --squash --delete-branch` 자율 실행
     조건 미달 시 원인(PR conflict / CI / policy / review)을 사용자에게 보고.
7. **T7 Cleanup** — merge/blocked 이후 agent close + worktree cleanup 또는 보존 사유 기록.

## PR body gates

- `Documentation impact` 필수. 자세히: [documentation](../documentation/memory.md).
- `Smoke impact` 필수. `Smoke-Test-Plan:` 에 smoke 추가 / 기존 smoke 로 충분 /
  불필요 판단 중 하나와 근거를 남긴다.
- PR body / comment 는 GitHub 에서 볼 수 있는 repo-relative path / URL 만 사용.
  `/Users`, `/tmp`, `file://`, `worktrees/` 근거 금지.

## Why

사용자 2026-05-16 강하게 lock — "커밋 왜 자꾸 나한테 하라고 지랄이야". 이전 패턴 (assistant = 변경 요약만 보고) retire. 사용자는 작업 완전 종료까지 책임지길 원함.

## 중단 조건 — 사용자 확인 / 별도 절차 필요

- `git push --force` / `--force-with-lease`: agent path 에서는 수행 금지
  ([git-policy.md](../../../.claude/rules/git-policy.md))
- main 직접 push (PR 우회)
- `gh pr merge` 의 squash/merge/rebase 정책이 명시 안 됐을 때
- 사용자 명시 거부 ("commit 하지 마", "push 멈춰") — 즉시 중단

## Hook 강제 — 절대 회피 금지

- `--no-verify` / `LEFTHOOK=0` / `--no-gpg-sign` 금지 ([git-policy.md](../../../.claude/rules/git-policy.md))
- hook 실패 시 회피 X, 근본 원인 fix.
- GPG signing pinentry timeout 시 즉시 중단. 사용자에게 cache warm-up 필요를
  보고하고, unsigned commit 으로 진행하지 않음.
- TDD-cycle hook 실패 시 skip env 를 쓰지 않는다. code-profile sprint 의
  RED evidence 요구는 [tdd](../tdd/memory.md) 를 따른다.

## Agent spawn 권장

- 리뷰: orchestrator 자기 리뷰 = 편향. `pr-reviewer` coordinator (`.claude/agents/pr-reviewer.md`) spawn 으로 독립 평가. [review](../review/memory.md) 행동 계약과 `.agents/skills/pr-review/SKILL.md` 적용.
- 외부 시각 필요 시 `codex-reviewer` (사용자 명시 시만, 자동 호출 X).
- Multi-worktree 병렬 시 각 worktree 의 delivery 도 delivery owner 가 소유.
  reviewer 는 read-only, merge 는 delivery owner 책임.

## Sync 책임

각 step 끝나면 1줄 보고 (PR URL / merge SHA 등). [implementation](../implementation/memory.md) 의 noise 차단 룰 정합 — 결과만, narration 없음.

## 관련

- `.claude/rules/git-policy.md` — `--no-verify` / `LEFTHOOK=0` 금지 + hook 강제
- `.claude/agents/delivery.md` — 본 룰 enforce agent
- `.claude/agents/pr-reviewer.md` — T4 review spawn 대상
- [review](../review/memory.md) — T4 review 행동 계약
- `.agents/skills/pr-review/SKILL.md` — T4 review 방법론
- [documentation](../documentation/memory.md) — 문서화 impact + evidence portability
- [implementation](../implementation/memory.md) — 직전 phase
- [tdd](../tdd/memory.md) — code-profile sprint RED evidence
- [engineering/conventions](../../engineering/conventions/memory.md) — Conventional Commits 형식 (`feat(scope): description`)
