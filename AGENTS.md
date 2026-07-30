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

**이 인덱스는 찾아가야 온다.** 예전에는 파일을 편집하면 PostToolUse hook
(`scripts/hooks/apply/surface-routing.sh`) 이 그 surface 의 active rule 목록을
컨텍스트로 밀어 넣었다. 그 hook 은 `scripts/` 트리와 함께 삭제됐다 (#2033).
지금은 아무것도 밀어 주지 않으므로 직접 열어야 한다.

**spawn 된 subagent 에 자동으로 닿는 채널은 이제 하나다** — `CLAUDE.md` 와
그것의 `@` import (이 파일이 그렇게 온다). 나머지 셋은 사라졌다: PostToolUse
hook, 선택자로 내려가던 `.claude/rules/*.md`, agent frontmatter `skills:` 의
스킬 본문. **마크다운 링크는 그때도 지금도 안 따라간다** — 매트릭스의 memory
경로는 agent 가 스스로 읽어야 한다.

## 강제 룰

아래 룰에는 **집행 장치가 없다.** 이걸 검사하던 훅·스크립트·CI 게이트는 전부
삭제됐다 (#2033). 어기면 아무도 막지 않으므로 agent 가 스스로 지킨다.

- `memory/` 트리: `memory.md` 만, 200줄 / 12,000 chars cap (둘 다).
- workflow memory 는 행동 계약만 둔다. 절차가 길어지면 memory 를 쪼개라 —
  긴 절차를 옮겨 담던 skill 계층은 없어졌다.
- ADR 동결. 결정 뒤집기 = 새 ADR + `Superseded`. 본문은
  `docs/archives/decisions/`.
- git/hook 회피 금지: 대표 예 `--no-verify` / force-push. 예전에는
  `scripts/hooks/policy/check-dangerous-bash.sh` 가 차단 목록의 SOT 이자
  집행자였다. 그 훅이 없으니 이제 SOT 는 `memory/workflow/git-policy/memory.md`
  하나이고 차단은 일어나지 않는다.
- primary worktree 는 orchestration-only: `AGENTS.md` / `memory/*` 외 편집 금지,
  소스는 linked worktree 에서. 생성 스크립트(`scripts/worktree-spawn.sh`) 는
  삭제됐으므로 `git worktree add` 를 직접 쓴다.
  `memory/runbook/worktree/memory.md`.

## 더 깊이

- `memory/memory.md` — 팔레스 입구
- `docs/PLAN.md` — roadmap/product 인덱스
- `docs/ROADMAP.md` — 미래 목표와 다음 후보
