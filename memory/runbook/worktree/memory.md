---
title: Multi-agent worktree runbook
type: runbook
updated: 2026-05-18
task: worktree, multi-agent, parallel
---

# Multi-agent worktree

다중 brain (Claude Code / Codex / Cursor) 또는 다중 agent 가 동일 repo 에서
병렬 작업할 때 worktree 로 인스턴스 격리. 각 worktree 는 독립 디렉토리 +
독립 branch + 독립 git hook → 충돌 없이 동시 실행.

## 사용 시점

- 여러 sprint 를 병렬 진행 (각 sprint = 1 worktree)
- 같은 sprint 의 다른 phase (generator / evaluator / delivery) 가 동시에
  진행해야 할 때 — 단 evaluator 는 readonly 라 일반 main worktree 에서
  spawn 해도 충돌 없음
- 사용자가 같은 repo 에서 다른 brain (예: Codex review + Claude implement)
  을 동시에 돌리고 싶을 때

## 명령

```bash
# 새 worktree + branch
bash scripts/worktree-spawn.sh sprint-388/foo

# 머지 끝난 worktree 정리
bash scripts/worktree-cleanup.sh sprint-388/foo

# main 머지된 worktree 일괄 정리
bash scripts/worktree-cleanup.sh --merged

# stale 메타데이터만 정리
bash scripts/worktree-cleanup.sh --prune
```

## 격리 동작

- worktree 디렉토리: `.claude/worktrees/<branch-sanitized>/` (repo 안, gitignored)
  - 예: `sprint-388/foo` → `.claude/worktrees/sprint-388__foo/`
  - `.claude/worktrees/` 는 `.gitignore` 처리 — Tailwind v4 source-scanner 가
    sibling 경로로 walk 하지 않도록 이전부터 무시되던 path 재사용
- git hook 은 worktree 별 `.git/worktrees/<name>/hooks/` 에 분리되어
  `lefthook install` 자동 실행
- working tree state (untracked / staged) 는 worktree 별 독립

## 책임

- spawn: orchestrator (현재 메인 세션) 가 명시 호출. agent 가 자율로
  worktree 생성하지 않음 (사용자가 보지 못하는 디스크 공간 차지 위험).
- cleanup: PR 머지 직후 또는 sprint 종료 시. `gh pr merge --delete-branch`
  는 branch 만 삭제 — worktree 디스크는 별도 정리 필요.

## 주의

- worktree 안에서 또 worktree spawn 하지 마. 동일 base repo 의 `.git/worktrees/`
  메타데이터가 중첩 시 추적 어려움.
- `git push --force` 같은 destructive 명령은 worktree 환경 무관하게
  `scripts/hooks/check-dangerous-bash.sh` 가 차단.

## 관련

- `scripts/worktree-spawn.sh` — 생성
- `scripts/worktree-cleanup.sh` — 정리
- [delivery](../../workflow/delivery/memory.md) — branch 머지 정책
- [git-policy](../../workflow/git-policy/memory.md) — hook 회피 금지
