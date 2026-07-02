# `.claude/agents/` — Claude Code agent wrappers

Claude Code 가 `Agent` tool 로 spawn 하는 agent 정의. **본 파일은 thin wrapper**
— 본문은 `memory/` 또는 `.agents/skills/` 의 source 로 redirect.

## 패턴 (sprint-387 lock)

각 wrapper 는 3-5 문장 lazy pointer:

```yaml
---
name: <agent-name>
description: <한 줄 — Claude Code 가 spawn 판단에 사용>
tools: [Read, Edit, Write, Bash, ...]
model: opus | sonnet | haiku
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
- 각 wrapper 본문 첫 줄에 리터럴 `caveman 모드.` 명시 (agent 파일 간 상속 메커니즘은 없음 — 아래 "caveman/ponytail 주입" 참조).

## caveman/ponytail 주입 (상속 아님)

Claude Code 하네스에 agent 정의 파일 간 **상속은 없다** — 각 `.md` 는 독립
프롬프트다. 모든 subagent 에 caveman(간결 응답)/ponytail(lazy 구현) 을 거는 실제
주입은 **userspace** `~/.claude/settings.json` 의 `SubagentStart` 훅
(`~/.agents/hooks/subagent-rules.js`, repo 밖) 이 런타임에 수행한다. 보강으로 각
wrapper 본문도 자체 `caveman 모드.` 줄을 하드코딩해 힌트를 남긴다. repo-side
caveman 규칙 본문은 `.agents/skills/caveman/SKILL.md` (과거 문서가 지목한
`memory/engineering/conventions/memory.md` 에는 caveman 내용 없음).

주입 훅을 repo (`scripts/hooks/`) 로 이관해 `.claude/settings.json` 에 등록하는
방안(#1022)은 런타임/userspace 를 건드리므로 사람 결정 대기 — 본 문서는 정정만.

## Multi-brain 호환

Codex / Cursor 도 같은 agent 개념 사용 시 본 wrapper 패턴을 base 로 — 각 brain
별 디렉토리 (`.codex/agents/`, `.cursor/agents/`) 에 같은 구조. 협업/코드 룰은
`memory/`, repo-owned skill 본문은 `.agents/skills/` 가 source.

## 관련

- `AGENTS.md` — universal entry (work-type → memory 매트릭스)
- `memory/memory.md` — 팔레스 입구
- `memory/workflow/memory.md` — 협업 phase 룰
- `memory/engineering/conventions/memory.md` — 코드 룰
- `.agents/skills/caveman/SKILL.md` — caveman 규칙 본문 (repo-side source)
- `.claude/rules/README.md` — auto-load rule wrapper 정책
- `.agents/skills/remember/SKILL.md`, `.agents/skills/split-memory/SKILL.md` — agent skill source
