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

## Pipeline

1. **Commit** — `git add <specific files>` + `git commit -m "..."` 실행. pre-commit hook 통과까지 책임.
2. **Push** — `git push`. pre-push hook 통과.
3. **PR** — `gh pr create` (또는 `create-pr` skill).
4. **Review** — self review 편향 우려 → `code-reviewer` agent spawn (독립 평가) 또는 `codex exec` 외부 리뷰 옵션 사용자에게 제시.
5. **반영** — 리뷰 피드백 → 코드 수정 → 추가 commit + push.
6. **Merge** — `gh pr merge` (정책에 맞는 방식).

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

- 리뷰: orchestrator 자기 리뷰 = 편향. `code-reviewer` agent (`.claude/agents/`) spawn 으로 독립 평가.
- Multi-worktree 병렬 시 각 worktree 의 delivery 도 sub-agent 자율 (subagent 권한 약한 해석 — `delivery` agent type 이어야 write 가능).

## Sync 책임

각 step 끝나면 1줄 보고 (PR URL / merge SHA 등). [implementation](../implementation/memory.md) 의 noise 차단 룰 정합 — 결과만, narration 없음.

## 관련

- `.claude/rules/git-policy.md` — `--no-verify` / `LEFTHOOK=0` 금지 + hook 강제
- `.claude/agents/delivery.md` — 본 룰 enforce agent
- `.claude/agents/code-reviewer.md` — 리뷰 spawn 대상
- [implementation](../implementation/memory.md) — 직전 phase
- [conventions](../../conventions/memory.md) — Conventional Commits 형식 (`feat(scope): description`)
