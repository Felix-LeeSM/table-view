# Agent Entry — universal

Claude Code / Codex / Cursor 모두 본 파일 1번 read. 본문 lazy, 작업 시 매트릭스만 보고 1-2 방 내려간다.

## Memory / Archive

- `memory/` = active operational SOT. 미래 agent 가 다시 읽고 행동을 바꿔야 하는 지식만 둔다.
- `memory/index/` = generated read router. Agent 는 작업 시작 시 index 로 필요한 SOT 를 찾고, worker 에는 task packet 수준의 최소 read set 만 넘긴다.
- `.agents/skills/` = 브레인 공통 skill 본문 원본. `.claude/skills/`, `.codex/skills/` 같은 브레인별 skill 복사본은 두지 않는다. 슬래시 명령 wrapper 는 필요할 때만 `.claude/commands/` 에 둔다.
- `docs/archives/` = history / raw audit / old decisions / raw lessons. 기본 read 대상 아님. 충돌·회고·근거 추적이 필요할 때만 검색한다. Raw lesson 은 SOT 가 아니며, 배울 내용은 관련 `memory/**/memory.md` 로 해석·흡수한다.
- Chat, 외부 memory, GitHub issue/comment 는 repo tracked file 로 반영되기 전까지 SOT 가 아니다.

## 작업 type → 먼저 read

| 작업                   | path                                               |
| ---------------------- | -------------------------------------------------- |
| 용어 / naming / UI copy | `memory/terminology/memory.md`                     |
| 결정 / grill           | `memory/workflow/grill/memory.md`                  |
| 버그 / 회귀            | `memory/workflow/bug-fix/memory.md`                |
| TDD / RED evidence     | `memory/workflow/tdd/memory.md`                    |
| commit / PR            | `memory/workflow/delivery/memory.md`               |
| 문서화 / PR body       | `memory/workflow/documentation/memory.md`          |
| git / PR / push reject | `memory/workflow/git-policy/memory.md`             |
| 보안 결정              | `memory/workflow/grill/security-handoff/memory.md` |
| cold-boot              | `memory/runbook/cold-boot/memory.md`               |
| worktree               | `memory/runbook/worktree/memory.md`                |

코드 만지기 전: `memory/terminology/memory.md` (용어 충돌 시) +
`memory/index/by-surface.md` (해당 surface 의 관련 SOT 묶음).

## 강제 룰

- `memory/` 트리: `memory.md` 만, 200줄 cap.
- ADR 동결. 결정 뒤집기 = 새 ADR + `Superseded`.
- main 직접 commit/push 금지. 작업은 branch + PR 로 전달하고 최종 반영은 human PR merge.
- `--no-verify` / `--no-gpg-sign` / `LEFTHOOK=0` / 사용자 승인 없는 `git push --force` 금지 (`.claude/rules/git-policy.md`).
- 대화 결정은 `/remember`.

## 더 깊이

- `memory/memory.md` — 팔레스 입구
- `docs/PLAN.md` — 마스터 플랜
