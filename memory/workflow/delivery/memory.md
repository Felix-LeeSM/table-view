---
title: Delivery — commit → push → PR → review → merge 자율 행동 계약
type: workflow-rule
updated: 2026-07-24
task: delivery, commit, push, pr, review, merge
trigger:
  signal: implementation 완료 / 사용자가 "마무리해" / sprint 종료
  layer: agent-prompt (delivery agent)
---

# Delivery — 행동 계약

작업 종료 시 delivery owner 가 commit → push → PR → review → merge → cleanup 을
자율 실행한다. 사용자에게 "이제 커밋해 주세요" 안내 금지.

이 방은 **행동 계약**(누가·언제·무엇을 지켜야 하나)만 둔다. T0~T7 오케스트레이션
절차 SOT 는 [`delivery` skill](../../../.agents/skills/delivery/SKILL.md).

## Ownership

- **orchestrator**: task 정의, worktree/agent 상태 추적, blocker 보고.
- **delivery owner**: 구현/commit/push/PR/review 반영/merge/cleanup 소유.
- **pr-reviewer**: read-only 판단자. commit / push / merge 금지.

한 PR 에 delivery owner 는 1명. review finding fix 는 같은 owner 에게 되돌려
reflect 시킨다. 실패 worker 를 계속 새로 쌓지 않음.

## 자율 실행 vs 중단

자율 진행이 기본. 다음 중단 조건 도달 시 즉시 멈추고 사용자에게 원인 보고:

- `git push --force` / `--force-with-lease`: agent path 에서 수행 금지
  ([git-policy.md](../../../.claude/rules/git-policy.md)).
- main 직접 push (PR 우회).
- `gh pr merge` 의 squash/merge/rebase 정책이 명시 안 됐을 때.
- 사용자 명시 거부("commit 하지 마", "push 멈춰") — 즉시 중단.

merge 자율 조건(모든 정성 차원 ≥ 8/10, CI SUCCESS + `review:approved`,
mergeable, 사용자 거부 없음)과 T0~T7 세부는 skill 참조.

## Hook 강제 — 절대 회피 금지

- `--no-verify` / `LEFTHOOK=0` / `--no-gpg-sign` 금지
  ([git-policy.md](../../../.claude/rules/git-policy.md)).
- hook 실패 시 회피 X, 근본 원인 fix.
- GPG signing pinentry timeout 시 즉시 중단. unsigned commit 으로 진행하지 않음.
- code-profile sprint 의 RED evidence 요구는 [tdd](../tdd/memory.md) 를 따른다.

## PR body gates

- `Documentation impact` 필수. 자세히: [documentation](../documentation/memory.md).
- `Smoke impact` 필수. `Smoke-Test-Plan:` 에 근거 명시.
- PR body / comment 는 GitHub 에서 볼 수 있는 repo-relative path / URL 만.
  `/Users`, `/tmp`, `file://`, `worktrees/` 근거 금지.

## Agent spawn — reviewer 독립

리뷰는 orchestrator 자기 리뷰 = 편향. `pr-reviewer` coordinator
(`.claude/agents/pr-reviewer.md`) spawn 으로 독립 평가.
[review](../review/memory.md) 행동 계약 + `.agents/skills/pr-review/SKILL.md` 적용.
외부 시각 필요 시 `codex-reviewer` (사용자 명시 시만). Multi-worktree 병렬 시 각
worktree 의 delivery 도 delivery owner 가 소유, merge 는 owner 책임.

## Why

사용자 2026-05-16 강하게 lock — "커밋 왜 자꾸 나한테 하라고 지랄이야". 이전 패턴
(assistant = 변경 요약만 보고) retire. 사용자는 작업 완전 종료까지 책임지길 원함.

## Sync 책임

각 step 끝나면 1줄 보고 (PR URL / merge SHA 등).
[implementation](../implementation/memory.md) 의 noise 차단 룰 정합 — 결과만,
narration 없음.

## 관련

- [`delivery` skill](../../../.agents/skills/delivery/SKILL.md) — T0~T7 절차 SOT
- `.claude/rules/git-policy.md` — `--no-verify` / `LEFTHOOK=0` 금지 + hook 강제
- `.claude/agents/delivery.md` / `.codex/agents/delivery.md` — delivery wrappers
- `.agents/skills/pr-create/SKILL.md` / `.agents/skills/pr-review/SKILL.md` — T3/T4 방법론
- [review](../review/memory.md) — T4 review 행동 계약
- [documentation](../documentation/memory.md) — 문서화 impact + evidence portability
- [tdd](../tdd/memory.md) — code-profile sprint RED evidence
- [engineering/conventions](../../engineering/conventions/memory.md) — Conventional Commits 형식
