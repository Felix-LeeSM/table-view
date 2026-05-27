---
sprint: 387
title: Multi-Agent Infra — Handoff
date: 2026-05-18
---

# Sprint 387 — Handoff

Sprint 386 의 agent harness 를 **multi-brain ready** 로 진화. 본문 (룰 source)
은 `memory/` 와 `.agents/skills/`, platform 디렉토리 (`.claude/`) 는 필요한
wrapper 만.

## 적용 후 동작

### Claude Code (현재)

- `.claude/rules/*.md` 의 `paths` frontmatter 가 working file 매치 시 자동
  로드 → wrapper 가 1-3 줄 redirect 만 보여줘서 토큰 절감.
- agent spawn 시 `.claude/agents/<name>.md` 의 9-15줄 본문이 system prompt
  머리에 붙음. 본문은 "memory/X 를 read 해" 명령만. read 가 *조건부* 인 경우
  (예: 보안 키워드 / 변경 500줄 이상) 진짜 lazy.
- `remember`, `split-memory` 은 `.agents/skills/<name>/SKILL.md` 가 source.
  `.claude/commands/{remember,split-memory}.md` wrapper 는 두지 않는다.

### Codex (미적용 — handoff 대상)

- `AGENTS.md` 1번 read 만으로 작업 type 점프 가능.
- `scripts/hooks/check-dangerous-bash.sh` 를 Codex 의 PreToolUse hook 으로
  연결 가능 — env 또는 argv 입력으로.
- Codex 전용 agent definition 형식 (`.codex/agents/*.md` 같은) 은 본 sprint
  scope 아님 → 차후 sprint 에서 정의. Claude Code 의 frontmatter 패턴을
  base 로 시작.

### Cursor (미적용 — handoff 대상)

- Cursor 의 rules / agents 인터페이스를 사용자가 사용 시점에 점검.
  `.cursorrules` 또는 `.cursor/rules/*.md` 같은 디렉토리에 wrapper 배치
  가능성.

## 미래 작업 (deferred)

| ID | 작업 | 근거 |
|---|---|---|
| D1 | Codex 전용 wrapper 형식 정의 | 본 sprint scope 외 |
| D2 | Cursor 전용 wrapper 형식 정의 | 본 sprint scope 외 |
| D3 | R2 — frontmatter trigger 만으로 wrapper 자동 derive | sprint-386 deferred 유지 |
| D4 | 기존 god file 43개 정리 | sprint-386 deferred 유지 |
| D5 | frontmatter retrofit (기존 memory.md 의 surface/task 필드) | sprint-386 deferred 유지 |
| D6 | multi-worktree 자동 생성 / 정리 orchestration | 본 sprint 는 script 만, 자동화는 별 sprint |
| D7 | sprint INDEX 자동 생성 | sprint-386 deferred 유지 |

## 운영 룰

- Source-of-truth: `memory/` 와 `.agents/skills/`. wrapper 수정 시 반드시
  해당 source 본문도 같이 수정. 그 반대도 동일.
- Skill 본문은 `.agents/skills/<name>/SKILL.md` 에만 둔다. Claude command
  wrapper 로 중복하지 않는다.
- `.claude/rules/*.md` 의 `paths` frontmatter 는 Claude Code 의 auto-load
  trigger — 본 trigger 가 깨지면 wrapper 가 매치되지 않아 redirect 가 의미
  없어짐. 변경 시 주의.
- Hook script 는 `scripts/hooks/check-dangerous-bash.sh` 가 권위. 새 pattern
  추가는 본 파일에만.

## 다음 사용 시점에 점검할 것

- agent spawn 후 `<thinking>` 첫 단락에서 "memory/X read" 가 실제 일어났나
  → 일어났으면 의도된 lazy load. 안 일어났으면 wrapper 메시지가 약함 →
  wrapper 강화.
- Codex 사용 시작 시: 본 sprint 의 universal entry (AGENTS.md) 가 첫 spawn
  에 사용되는지 관찰. 안 되면 brain 별 entry 추가 필요.
- worktree 사용 시: `.claude/worktrees/` 가 디스크에 누적되지 않는지
  `worktree-cleanup.sh --merged` 정기 실행.
