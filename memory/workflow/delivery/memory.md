---
title: Delivery — commit → merge 전체 자율
type: workflow-rule
updated: 2026-05-17
task: delivery, commit, push, pr, review, merge
trigger:
  signal: implementation 완료 / 사용자가 "마무리해" / sprint 종료
  layer: agent-prompt (delivery agent)
---

# Delivery — commit → push → PR → review → merge 전체 자율

작업 종료 시 agent 가 다음 pipeline 을 자율 실행. 사용자에게 "이제 커밋해 주세요" 안내 금지.

## Pipeline (T0~T6)

1. **T1 Commit** — `git add <specific files>` + `git commit -m "..."`. pre-commit hook 통과 책임 (포맷 / lint / no-secrets / ADR 동결).
2. **T2 Push** — `git push`. pre-push hook 통과 (7 stage + TDD 사이클 8 stage — code profile 만).
3. **T3 PR** — `gh pr create`. body 는 sprint contract 의 요약 view (Summary / Changes / Invariants / Test plan / Deferred / Links).
4. **T4 Review** — `evaluator` agent spawn (1회, default 자동):
   - 정량은 자동 layer (hook / lint / pre-push / scripts/review/run-checks.sh) 가 이미 함
   - evaluator 는 정성 3 차원 (Mock 범위 / 정합성 / Sprint contract scope) + profile 별 추가 차원
   - 출력: scorecard PR comment (`memory/workflow/review/memory.md` 형식)
   - **외부 옵션**: 사용자가 "codex 리뷰도 받아" → `codex-reviewer` 추가
5. **T5 반영** — 결함 발견 시 fix commit + push → T1~T4 재시작
6. **T6 Merge** — 자율 머지 조건:
   - 정성 모든 차원 ≥ 7/10
   - `gh pr checks` SUCCESS (CI green)
   - 사용자 명시 거부 없음
   → `gh pr merge --squash --delete-branch` 자율 실행
   조건 미달 시 사용자 확인 (예: 일부 결함 ack 후 머지 강행)

## Why

사용자 2026-05-16 강하게 lock — "커밋 왜 자꾸 나한테 하라고 지랄이야". 이전 패턴 (assistant = 변경 요약만 보고) retire. 사용자는 작업 완전 종료까지 책임지길 원함.

## 예외 — 사용자 확인 필수

- `git push --force` / `--force-with-lease` ([git-policy.md](../../../.claude/rules/git-policy.md))
- main 직접 push (PR 우회)
- `gh pr merge` 의 squash/merge/rebase 정책이 명시 안 됐을 때
- 사용자 명시 거부 ("commit 하지 마", "push 멈춰") — 즉시 중단

## Hook 강제 — 절대 회피 금지

- `--no-verify` / `LEFTHOOK=0` 금지 ([git-policy.md](../../../.claude/rules/git-policy.md))
- hook 실패 시 회피 X, 근본 원인 fix.
- GPG signing pinentry timeout 시 사용자에게 cache 안내 1회, 그 외 진행.

## Agent spawn 권장

- 리뷰: orchestrator 자기 리뷰 = 편향. `evaluator` agent (`.claude/agents/evaluator.md`) spawn 으로 독립 평가. [review](../review/memory.md) 룰 적용.
- 외부 시각 필요 시 `codex-reviewer` (사용자 명시 시만, 자동 호출 X).
- Multi-worktree 병렬 시 각 worktree 의 delivery 도 sub-agent 자율 (subagent 권한 약한 해석 — `delivery` agent type 이어야 write 가능).

## Sync 책임

각 step 끝나면 1줄 보고 (PR URL / merge SHA 등). [implementation](../implementation/memory.md) 의 noise 차단 룰 정합 — 결과만, narration 없음.

## 관련

- `.claude/rules/git-policy.md` — `--no-verify` / `LEFTHOOK=0` 금지 + hook 강제
- `.claude/agents/delivery.md` — 본 룰 enforce agent
- `.claude/agents/evaluator.md` — T4 review spawn 대상
- [review](../review/memory.md) — T4 review 룰 (3 정성 + profile)
- [implementation](../implementation/memory.md) — 직전 phase
- [conventions](../../conventions/memory.md) — Conventional Commits 형식 (`feat(scope): description`)
