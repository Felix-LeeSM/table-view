# Agent Entry — universal

Claude Code / Codex / Cursor 모두 본 파일 1번 read. 본문 lazy, 작업 시 매트릭스만 보고 1-2 방 내려간다.

## 작업 type → 먼저 read

| 작업 | path |
|---|---|
| 결정 / grill | `memory/workflow/grill/memory.md` |
| 버그 / 회귀 | `memory/workflow/bug-fix/memory.md` |
| TDD 신규 | `.claude/skills/tdd/SKILL.md` |
| commit / PR | `memory/workflow/delivery/memory.md` |
| 보안 결정 | `memory/workflow/grill/security-handoff/memory.md` |
| cold-boot | `memory/runbook/cold-boot/memory.md` |
| worktree | `memory/runbook/worktree/memory.md` |

코드 만지기 전: `memory/index/by-surface.md` (해당 ADR/lesson 묶음).

## 강제 룰

- `memory/` 트리: `memory.md` 만, 200줄 cap.
- ADR 동결. 결정 뒤집기 = 새 ADR + `Superseded`.
- `--no-verify` / `LEFTHOOK=0` / 사용자 승인 없는 `git push --force` 금지 (`.claude/rules/git-policy.md`).
- 대화 결정은 `/remember`.

## 더 깊이

- `memory/memory.md` — 팔레스 입구
- `docs/PLAN.md` — 마스터 플랜
