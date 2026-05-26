# `.claude/agents/` — Claude Code agent wrappers

Claude Code 가 `Agent` tool 로 spawn 하는 agent 정의. **본 파일은 thin wrapper**
— 본문은 모두 `memory/` 의 source room 으로 redirect.

## 패턴 (sprint-387 lock)

각 wrapper 는 3-5 문장 lazy pointer:

```yaml
---
name: <agent-name>
description: <한 줄 — Claude Code 가 spawn 판단에 사용>
tools: [Read, Edit, Write, Bash, ...]
model: opus | haiku
---

caveman 모드. 작업 시 read:
1. memory/<source-room>/memory.md (룰)
2. 조건부 read (보안 키워드 / god file 등)
금지: --no-verify, LEFTHOOK=0, destructive Bash
```

## 룰

- 본문 **9-15줄 cap**. 50줄 넘으면 lazy 위반 — source 로 옮기고 redirect.
- main read (해당 agent 본인 룰) 는 강제, 조건부 read 만 진짜 lazy.
- frontmatter `name` / `description` / `tools` / `model` 필수.
- caveman skill 첫 줄에 명시 (`memory/conventions/memory.md` 의 caveman 룰 상속).

## Multi-brain 호환

Codex / Cursor 도 같은 agent 개념 사용 시 본 wrapper 패턴을 base 로 — 각 brain
별 디렉토리 (`.codex/agents/`, `.cursor/agents/`) 에 같은 구조. 본문 (룰) 은
`memory/` 또는 `.agents/skills/` 가 source.

## 관련

- `AGENTS.md` — universal entry (work-type → memory 매트릭스)
- `memory/memory.md` — 팔레스 입구
- `memory/workflow/memory.md` — 협업 phase 룰
- `memory/conventions/memory.md` — 코드 룰 (caveman 포함)
- `.claude/rules/README.md` — auto-load rule wrapper 정책
- `.agents/skills/README.md` — slash command wrapper 정책 (commands/ 디렉토리는
  README.md 두면 slash command 로 잘못 등록되므로 정책을 source room 에 보관)
