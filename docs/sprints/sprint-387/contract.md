---
sprint: 387
title: multi-agent infra — lazy wrappers + platform-neutral hooks/rules/commands
date: 2026-05-18
owner: orchestrator
status: in_progress
---

# Sprint 387 Contract — Multi-Agent Infrastructure (Lazy)

## Goal

sprint-386 의 agent harness 인프라를 **agent-platform-neutral** 로 진화. Claude
Code / Codex / Cursor / 미래 brain 어떤 것이든 같은 룰, 같은 훅, 같은 작업
방식으로 동작하되 *두뇌만* 갈아끼울 수 있게 만든다.

핵심 원칙 (사용자 2026-05-18 lock):

> "agent 가 필요할 때 필요한 문서만 read."

따라서 모든 wrapper / rule / command 는 **lazy 패턴** — 본문은 `memory/` 또는
`scripts/` 에 source-of-truth 1부, platform-specific 디렉토리 (`.claude/`,
`.codex/`, `.cursor/`) 에는 *얇은 포인터* 만.

## Scope

### In scope

1. **Agent wrapper 압축** — `.claude/agents/*.md` 9개 파일 50-90 줄
   → **3-7 줄 lazy pointer** 로 축소. 모든 본문은 `memory/workflow/` 또는
   `memory/conventions/` 의 기존 source-of-truth 로 redirect.
2. **`AGENTS.md` 신설** — 루트 universal entry. 5-15 줄 work-type → memory
   path 매트릭스. Codex / Cursor 모두 본 파일을 1번 read.
3. **`CLAUDE.md` 슬림화** — sprint-386 작업으로 두꺼워진 본문을 redirect-only
   로 축소 (≤ 20 줄). Claude Code 의 기본 read 비용 절감.
4. **Hook 평면화** — `.claude/hooks/pre-bash.sh` 를
   `scripts/hooks/check-dangerous-bash.sh` 로 이동. multi-input adapter:
   - env var `$COMMAND`
   - argv `$1`
   - stdin JSON (`.tool_input.command`)
   세 입력 모두 처리해 Claude Code (현재 stdin JSON) / lefthook / 임의 CI
   호출 모두 호환.
5. **Rules 평면화** — `.claude/rules/*.md` 6개 본문을 `memory/conventions/`
   / `memory/workflow/` 의 기존 방으로 흡수. `.claude/rules/` 디렉토리는
   *얇은 wrapper* (1-3 줄 redirect) 만 남김. paths frontmatter (auto-load
   trigger) 는 wrapper 에 보존.
6. **Commands 평면화** — `.claude/commands/remember.md`,
   `.claude/commands/split-memory.md` 본문을 `memory/skills/<name>/memory.md`
   로 이동. `.claude/commands/<name>.md` 는 1줄 redirect.
7. **Worktree 인프라** — `scripts/worktree-spawn.sh`,
   `scripts/worktree-cleanup.sh` 2개 script + `memory/runbook/worktree/memory.md`
   사용 룰. 다중 agent 병렬 작업의 인스턴스 격리.
8. **README 갱신** — `.claude/agents/README.md`, `.claude/rules/README.md`,
   `.claude/commands/README.md` 3개 (없으면 신규) — wrapper 정책 명시.

### Out of scope (deferred)

- **Codex / Cursor 전용 wrapper 작성** — 본 sprint 는 공통 source-of-truth 만
  정비. 실제 `.codex/agents/*.md`, `.cursor/agents/*.md` 형식은 각 brain
  사용 시점에 별 sprint 로 생성. handoff.md 에 차후 작업 명시.
- **Hook 추가** — `pre-edit`, `pre-write` 등 미래 hook 은 본 sprint scope 아님.
- **Auto-derive (R2)** — frontmatter trigger 만으로 wrapper 자동 생성하는
  full automation 은 별 sprint (sprint-386 handoff D1).
- **기존 god file 정리 (D6) / frontmatter retrofit (D7)** — 본 sprint 무관.

## Invariants

- `.claude/rules/*.md` 의 `paths` frontmatter trigger 동작 보존 (Claude Code
  auto-load 호환). 본문이 redirect 만이어도 `paths` 가 있으면 동일 trigger
  발생.
- `.claude/hooks/pre-bash.sh` 호출 경로 (PreToolUse Bash hook) 호환 — wrapper
  로 `scripts/hooks/check-dangerous-bash.sh` 호출.
- `.claude/commands/*.md` 의 `description` frontmatter 보존 — slash command
  목록에서 사라지면 안 됨.
- `.claude/agents/*.md` 의 frontmatter (`name`, `description`, `tools`,
  `model`) 보존 — agent type 발견 / spawn 동작 동일.
- 기존 sprint-386 hook (`scripts/check-god-file.sh`,
  `scripts/regenerate-indexes.sh`, `scripts/check-memory-structure.sh`) 호출
  경로 unchanged.
- `memory/` 트리는 여전히 `memory.md` 만 (`scripts/check-memory-structure.sh`
  PASS).

## Acceptance Criteria

- `AC-387-01` `wc -l .claude/agents/*.md` 모두 ≤ 15. (현재 50-90 → 압축 확인.)
- `AC-387-02` `AGENTS.md` 루트에 존재, 5-30 줄, work-type 매트릭스 포함.
- `AC-387-03` `CLAUDE.md` ≤ 25 줄, 본문이 `memory/memory.md` redirect.
- `AC-387-04` `scripts/hooks/check-dangerous-bash.sh` 존재, executable,
  3 입력 (env / argv / stdin JSON) 처리. `.claude/hooks/pre-bash.sh` 는
  wrapper 로 위 스크립트 호출.
- `AC-387-05` `.claude/rules/*.md` 6개 모두 ≤ 20 줄, paths frontmatter 보존,
  본문이 `memory/` redirect (frontmatter 다중 path 때문에 cap 20 줄).
- `AC-387-06` `.claude/commands/{remember,split-memory}.md` 각 ≤ 15 줄,
  본문 `memory/skills/` redirect.
- `AC-387-07` `memory/skills/remember/memory.md`,
  `memory/skills/split-memory/memory.md` 신설, sprint-386 의 본문 보존.
- `AC-387-08` `scripts/worktree-spawn.sh`, `scripts/worktree-cleanup.sh`
  존재, executable, `--help` 실행 OK.
- `AC-387-09` `memory/runbook/worktree/memory.md` 존재, runbook room 룰
  (사용 시점 / 명령 / 정리) 포함.
- `AC-387-10` `bash scripts/check-memory-structure.sh` exit 0.
- `AC-387-11` `bash scripts/hooks/check-dangerous-bash.sh < <(echo '{"tool_input":{"command":"git push --force"}}')` exit 1 (block).
- `AC-387-12` `bash scripts/hooks/check-dangerous-bash.sh < <(echo '{"tool_input":{"command":"ls"}}')` exit 0 (allow).
- `AC-387-13` `pnpm tsc --noEmit` clean.
- `AC-387-14` `pnpm lint` clean.
- `AC-387-15` `pnpm vitest run` PASS (baseline 4128+).
- `AC-387-16` `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` clean.
- `AC-387-17` `git log --oneline` 에 sprint-387 commit 존재, body 에 본
  contract 링크.

## Design Bar / Quality Bar

- **TDD 적용 안 함** — 본 sprint 는 *문서 / 인프라 재배치*. 코드 변경 0
  (src/, src-tauri/ 한 글자도 안 건드림). Test 는 hook script 자체 동작
  확인 (AC-387-11/12 의 stdin smoke) 만.
- **삭제 우선** — wrapper 압축은 본문 삭제 + redirect 추가. 새 컴포넌트
  / IPC / store 0.
- **Memory source-of-truth 1부** — 같은 룰이 .claude/rules/ 와 memory/
  양쪽에 있으면 안 됨. wrapper 는 redirect only.
- **Caveman 톤** — 모든 wrapper / runbook / script 주석 짧고 정확.
- **사용자 인터럽트 가능성** — 본 sprint 는 PR 단계까지 가서 사용자
  리뷰 후 머지. 자동 머지 금지.

## Verification Plan

### Required Checks

1. `wc -l .claude/agents/*.md .claude/rules/*.md .claude/commands/*.md CLAUDE.md AGENTS.md` — 줄수 cap 확인.
2. `bash scripts/check-memory-structure.sh`
3. `bash scripts/check-god-file.sh` (영향 없음 확인)
4. `bash scripts/regenerate-indexes.sh` (memory/ 새 방 추가 후 index 재생성)
5. Hook smoke: AC-387-11, AC-387-12.
6. Worktree script smoke: `bash scripts/worktree-spawn.sh --help` exit 0.
7. `pnpm tsc --noEmit`
8. `pnpm lint`
9. `pnpm vitest run`
10. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings && cargo test`
11. `gh pr create` (생성만, 머지 NOT)

### Required Evidence

- 줄수 cap 통과한 wrapper / rule / command 목록.
- 3 입력 (env/argv/stdin) hook smoke PASS 출력.
- worktree script `--help` 출력.
- tsc / lint / vitest / clippy clean.
- PR URL.

## Test Requirements

- Vitest 신규 0 (코드 변경 0). 기존 4128+ test baseline 통과 확인만.
- Hook 자체 동작은 inline smoke (AC-387-11/12).

## Ownership

- Generator: orchestrator (현재 메인 세션) — sprint-386 와 동일 모드.
- Write scope: In Scope 의 8 항목.
- Merge order: 사용자 리뷰 통과 후 squash merge. **자동 머지 금지**.

## Exit Criteria

- Open P1/P2: 0
- AC 17/17 PASS
- 사용자 PR 리뷰 통과
- handoff.md 에 Codex/Cursor 전용 wrapper 후속 sprint 명시
