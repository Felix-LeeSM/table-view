---
sprint: 387
title: Multi-Agent Infra — Findings
date: 2026-05-18
---

# Sprint 387 — Findings

## AC 결과

| AC | 결과 | 증거 |
|---|---|---|
| 387-01 (`.claude/agents/*.md` ≤ 15줄) | PASS | `wc -l` 9파일 모두 9~15줄 |
| 387-02 (`AGENTS.md` 5-30줄 + 매트릭스) | PASS | 29줄, 7행 매트릭스 |
| 387-03 (`CLAUDE.md` ≤ 25줄 redirect) | PASS | 20줄, AGENTS.md redirect |
| 387-04 (hook script multi-input) | PASS | env / argv / stdin JSON 3입력 smoke 통과 |
| 387-05 (`.claude/rules/*.md` ≤ 20줄) | PASS | 6파일 모두 8~16줄, paths frontmatter 보존 |
| 387-06 (`.claude/commands/{remember,split-memory}.md` 없음) | PASS | Claude command wrapper 2파일 삭제 |
| 387-07 (`.agents/skills/{remember,split-memory}/SKILL.md`) | PASS | repo-owned skill source 보존 |
| 387-08 (worktree script + `--help`) | PASS | spawn / cleanup `--help` 모두 exit 0 |
| 387-09 (`memory/runbook/worktree/memory.md`) | PASS | 50+줄, 사용 시점 + 명령 + 격리 동작 + 책임 + 주의 |
| 387-10 (`check-memory-structure.sh`) | PASS | exit 0 |
| 387-11 (hook block `git push --force`) | PASS | exit 1 + BLOCKED 메시지 |
| 387-12 (hook allow `ls`) | PASS | exit 0 |
| 387-13 (`pnpm tsc --noEmit`) | PASS | clean |
| 387-14 (`pnpm lint`) | PASS | 0 errors, 43 warnings (sprint-386 baseline, 본 sprint 무영향) |
| 387-15 (`pnpm vitest run`) | PASS | 4197 passed / 11 skipped (baseline 4128+ 대비 진척) |
| 387-16 (`cargo clippy -D warnings`) | PASS | clean |
| 387-17 (sprint-387 commit + body 링크) | (commit 단계에서) | — |

## 주요 변경

### 1. Agent wrappers (50-90 → 9-15줄)

9 파일 모두 lazy 패턴:
```
---
name / description / tools / model
---
caveman 모드. 작업 시 read:
1. memory/...
2. 조건부 read (보안 키워드 / 변경 ≥ 500줄 시 ...)
금지: --no-verify ...
```

토큰 절감:
- 이전: agent 1개 마운트 시 ~50-90 줄 = ~1500-2700 tokens
- 이후: ~9-15 줄 = ~250-450 tokens
- 9 agent 통합: ~5000+ tokens saved per spawn cycle

### 2. AGENTS.md (universal entry, 29줄)

매트릭스 7행: grill / bug-fix / TDD / commit / 보안 / cold-boot / worktree.
Codex / Cursor / 미래 brain 모두 본 파일 1번만 read 하면 작업 type → memory
path 점프.

### 3. Hook script 평면화

- `scripts/hooks/check-dangerous-bash.sh` (platform-neutral, 3 입력)
- `.claude/hooks/pre-bash.sh` (Claude Code wrapper, 5줄 `exec` only)

3 입력 동작:
- env `$COMMAND` (lefthook / CI)
- argv `$1` (직접 호출)
- stdin JSON `.tool_input.command // .command` (Claude Code / Codex MCP)

이제 같은 패턴 차단 룰을 모든 brain 에 동일 적용.

### 4. Rules / Agent skills 평면화

- Rule 본문은 `memory/` 로 이동 (source of truth 1부)
- `.claude/rules/*.md` 6 파일은 frontmatter (paths trigger) + 1-3 줄 redirect
- `remember`, `split-memory` 은 `.agents/skills/<name>/SKILL.md` 가 source
- `.claude/commands/{remember,split-memory}.md` wrapper 는 삭제
- 신설 memory rooms:
  - `memory/workflow/git-policy/memory.md` (60줄)
  - `memory/engineering/conventions/rust/memory.md` (76줄)
  - `memory/engineering/conventions/react/memory.md` (102줄)

### 5. Worktree 인프라

- `scripts/worktree-spawn.sh` — `.claude/worktrees/<sanitized>/` 에 생성
  (사용자 추가 요청 반영 — gitignored 경로 재사용)
- `scripts/worktree-cleanup.sh` — 단일 / `--merged` / `--prune` 3 모드
- `memory/runbook/worktree/memory.md` — 사용 시점 / 명령 / 격리 동작 / 책임

## 회귀 영향

- src/, src-tauri/ 한 글자도 안 건드림. vitest 4197 PASS, clippy clean.
- lint 43 warnings 는 모두 god file (≥ 500줄) max-lines warn — sprint-386
  PostToolUse hook 이 도입한 baseline. 본 sprint 와 무관.
- e2e 영향 0 (e2e/ 디렉토리 무수정).

## 후속 작업 (handoff)

- Codex 전용 wrapper (`.codex/agents/*.md`) 형식 — 별 sprint
- Cursor 전용 wrapper (`.cursor/*`) 형식 — 별 sprint
- 자동 derive (R2) — sprint-386 의 deferred D1 그대로
- 기존 god file 43개 정리 — sprint-386 의 D6 그대로
