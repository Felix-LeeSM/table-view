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

작업 시 read:
1. memory/<source-room>/memory.md (룰)
2. 조건부 read (보안 키워드 / god file 등)
금지: --no-verify, LEFTHOOK=0, destructive Bash
```

## 룰

- 본문 **9-15줄 cap**. 50줄 넘으면 lazy 위반 — source 로 옮기고 redirect.
- main read (해당 agent 본인 룰) 는 강제, 조건부 read 만 진짜 lazy.
- frontmatter `name` / `description` / `tools` / `model` 필수. subagent spawn
  도구명은 `Agent` (구세대 별칭 `Task` 금지 — drift 소스).
- **중첩 spawn 불가**: subagent 는 또 다른 subagent 를 spawn 못 한다 (top-level
  세션만 `Agent` tool 사용). fan-out coordinator (`pr-reviewer`) 는 top-level
  전용이고, spawn 실패 시 관점-순차 단독 검증으로 강등한다 — 기준·fallback SOT 는
  `.agents/skills/pr-review/SKILL.md` Review Pack.
- 공통 규칙을 한 wrapper 에만 적어 두지 않는다. agent 정의 파일 간 상속
  메커니즘이 없어 나머지 agent 에는 전달되지 않는다 — 아래 "subagent 가 보는 것"
  참조.

## subagent 가 보는 것 (상속 두 가지를 구분)

**agent 정의 파일끼리는 상속이 없다.** `.claude/agents/*.md` 는 각각 독립
프롬프트다. 한 wrapper 가 다른 wrapper 의 본문을 물려받는 경로는 없다.

**subagent 는 `CLAUDE.md` 를 물려받는다.** 도구 사용 0회 프로브(#1864 측정 1)로
확인 — subagent 컨텍스트에 repo `CLAUDE.md` 와 `.claude/rules/*` 의 고유 문자열,
그리고 `~/.claude/CLAUDE.md` 가 `@` import 한 `~/.agents/AGENTS.md` 본문이 모두
있었다. 반면 repo 루트 `AGENTS.md` 본문은 없었다 — `CLAUDE.md` 가 마크다운
링크로만 가리키기 때문이다. 즉 **`@` import 는 따라가고 마크다운 링크는 안
따라간다.** 링크로만 걸린 문서(`AGENTS.md`, `memory/index/by-surface.md`)를
subagent 가 읽게 하려면 spawn prompt 에 경로를 직접 적어야 한다.

`CLAUDE.md` / `AGENTS.md` 는 세션 시작 시 한 번 읽어 스냅샷으로 잡힌다. 고쳐도
진행 중인 세션에는 안 먹으므로 반영 확인은 새 세션에서 한다(#1864 측정 2). 훅은
subagent spawn 마다 다시 실행되므로 즉시 반영된다.

ponytail(lazy 구현) 을 모든 subagent 에 거는 주입은 **userspace**
`~/.claude/settings.json` 의 `SubagentStart` 훅
(`~/.agents/hooks/subagent-rules.js`, repo 밖) 이 런타임에 수행한다. 같이 걸려
있던 출력 압축 모드 주입은 2026-07-29 에 제거했다(#1864).

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
- `.claude/rules/README.md` — auto-load rule wrapper 정책
- `.agents/skills/remember/SKILL.md`, `.agents/skills/split-memory/SKILL.md` — agent skill source
