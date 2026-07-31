# Agent Entry — universal

Claude Code / Codex / Cursor 모두 본 파일 1번 read. 본문 lazy, 작업 시 매트릭스만 보고 1-2 방 내려간다.

## 작업 type → 먼저 read

| 작업                   | path                                                   |
| ---------------------- | ------------------------------------------------------ |
| 기능 빌드 / 구현 / 코드 작성 | `memory/workflow/implementation/memory.md` (agent 자율성·noise 차단) |
| 버그 / 회귀            | `memory/workflow/bug-fix/memory.md`                    |
| 리팩토링 / 아키텍처    | `memory/engineering/conventions/refactoring/memory.md` |
| TDD / RED evidence     | `memory/workflow/tdd/memory.md`                        |
| commit / PR            | `memory/workflow/delivery/memory.md`                   |
| PR review              | `memory/workflow/review/memory.md`                     |
| 병렬 작업 / 이슈 발행  | `memory/workflow/orchestration/memory.md` (spawn·리뷰 큐·사이클 정지·이슈 수용기준) |
| 문서화 / PR body       | `memory/workflow/documentation/memory.md`              |
| git / PR / push reject | `memory/workflow/git-policy/memory.md`                 |
| PR merge 막힘 / BLOCKED | `memory/runbook/pr-merge-gates/memory.md` (required CI green·review-gate·ruleset 게이트 진단) |
| worktree               | `memory/runbook/worktree/memory.md`                    |

코드 만지기 전: `memory/index/by-surface.md` (해당 active rule 묶음).

**이 인덱스는 찾아가야 온다.** 편집한 파일의 surface rule 을 컨텍스트로 밀어
주는 장치는 없다 — 직접 열어야 한다.

**spawn 된 subagent 에 자동으로 닿는 채널은 하나뿐이다** — `CLAUDE.md` 와
그것의 `@` import (이 파일이 그렇게 온다). **마크다운 링크는 안 따라간다** —
매트릭스의 memory 경로는 agent 가 스스로 읽어야 한다.

## 강제 룰

아래 룰에는 **집행 장치가 없다.** 어기면 아무도 막지 않으므로 agent 가 스스로
지킨다.

- `memory/` 트리: `memory.md` 만, 200줄 / 12,000 chars cap (둘 다).
- workflow memory 는 행동 계약만 둔다. 절차가 길어지면 memory 를 쪼개라 —
  긴 절차를 옮겨 담을 다른 계층은 없다.
- ADR 동결. 결정 뒤집기 = 새 ADR + `Superseded`. 본문은
  `docs/archives/decisions/`.
- git/hook 회피 금지: 대표 예 `--no-verify` / force-push. SOT 는
  `memory/workflow/git-policy/memory.md` 하나이고 차단은 일어나지 않는다.
- primary worktree 는 orchestration-only: `AGENTS.md` / `memory/*` 외 편집 금지,
  소스는 linked worktree 에서. `git worktree add` 를 직접 쓴다 —
  `memory/runbook/worktree/memory.md`.

## 더 깊이

- `memory/memory.md` — 팔레스 입구
- `docs/PLAN.md` — roadmap/product 인덱스
- `docs/ROADMAP.md` — 미래 목표와 다음 후보
