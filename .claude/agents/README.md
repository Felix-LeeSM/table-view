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
확인 — subagent 컨텍스트에 repo `CLAUDE.md`, 그리고 `~/.claude/CLAUDE.md` 가
`@` import 한 `~/.agents/AGENTS.md` 본문이 있었다. 반면 repo 루트 `AGENTS.md`
본문은 없었다 — 그때 `CLAUDE.md` 가 마크다운 링크로만 가리켰기 때문이다. 즉
**`@` import 는 따라가고 마크다운 링크는 안 따라간다.** #1865 가 그 링크를
`@AGENTS.md` 로 바꿔 지금은 도달한다. 여전히 링크로만 걸린 문서
(`memory/index/by-surface.md`, `docs/PLAN.md`)는 spawn prompt 에 경로를 직접
적어야 subagent 가 읽는다.

**`.claude/rules/` 는 링크와 무관한 별도 채널이다.** 무조건 내려가는 것은
`README.md`(frontmatter 없음)와 `git-policy.md`(`paths: "**"`) 둘이다. 나머지
— `testing.md`, `test-scenarios.md`, `react-conventions.md`,
`rust-conventions.md`, `e2e-scenarios.md` — 는 working file path 가 자기 glob 에
매치할 때만 붙는다. 그래서 `CLAUDE.md` 의 링크 셋 중 `git-policy.md` 만
도달하는데, 그것도 링크가 아니라 `paths: "**"` 때문이다. 공통 룰을 좁은 glob
wrapper 에 두면 그 확장자를 안 건드리는 subagent 는 못 본다.

**frontmatter `skills:` 는 스킬 본문 전문을 spawn 된 subagent 에 주입한다.** 도구
사용 0회 프로브(#1931, `claude 2.1.220` / haiku)로 확인 — `skills:` 를 단 정의로
spawn 한 subagent 는 저장소에 없는 표식을 그대로 인용했고, 그 필드 하나만 뺀
대조군은 `tool_uses: 0` 에서 못 했다. 들어간 것은 스킬 파일 **본문 + base
directory 한 줄**이고 frontmatter `description` 은 안 들어갔다. 단 이건
`~/.claude/skills/` 의 실파일 하나로 잰 것이다 — 이 저장소 스킬은 전부
`.agents/skills/` 심링크라 같은지는 안 쟀다(#1944). 도달 표면도 둘만 쟀다:
`Agent` tool 로 spawn 하면 오고, 같은 정의를 `claude --agent <name>` 으로 세션
본체에 걸면 안 온다. 정의를 새로 쓰거나 고쳐도 **즉시 반영되지 않는다** — 파일을
쓴 직후 spawn 은 `Agent type '<name>' not found` 로 실패했고 같은 세션
뒤쪽에서는 성공했다. 갱신 트리거와 지연은 안 쟀으니 반영 확인은 새 세션에서
해라. 스킬 파일은 반대로 쓴 직후 목록에 붙는다.

**같은 프로브로 잰 나머지 frontmatter 필드.** `memory: project` 는
`<project>/.claude/agent-memory/<agent-name>/` 를 만들고 그 경로를 주입한다
(`user` / `local` 은 안 쟀다). `isolation: worktree` 는
`.claude/worktrees/agent-<id>` 에서 돌고, 변경이 없으면 자동 정리된다.
`maxTurns` 는 걸리는데 한도에 걸린 subagent 는 **반환값을 통째로 잃는다** —
인계를 반환에 싣는 노드에는 걸지 마라. `hooks:` 는 `PreToolUse` 가 발화했고
`SessionStart` / `SubagentStart` 는 발화하지 않았다. `PostToolUse` 등 나머지
이벤트는 안 쟀다. **여기서 잰 표면은 frontmatter 뿐이다.** `settings.json` 은
다른 표면이고 거기 걸린 `SubagentStart` 는 지금 실제로 돈다 — 아래 ponytail 주입
문단이 그 반례다. 그러니 "시작 지점 강제가 불가능" 이 아니라 **frontmatter 에
시작 이벤트가 없을 뿐**이다. `settings.json` 레벨은 #1943 이 잰다. frontmatter
YAML 이 깨지면 그 정의는 **에러 없이 목록에서 사라진다** — stderr 에도
`-p --debug` 파이프에도 안 뜬다. 진단은 파일에 남는다:
`grep -rh "Failed to parse YAML frontmatter" ~/.claude/debug/`. 따옴표 없는
스칼라에 `: ` 를 넣지 마라. 명령·출력 전문과 재현 절차는 #1931 코멘트.

`CLAUDE.md` / `AGENTS.md` 는 세션 시작 시 스냅샷으로 잡힌다. 고쳐도 진행 중인
세션에는 안 먹으므로 반영 확인은 새 세션에서 한다(#1864 측정 2). 단 스냅샷이
세션당 하나는 아니다 — 다른 checkout 의 파일을 건드리면 그쪽 `CLAUDE.md` 가
중간에 추가로 주입된다. worktree 를 오가는 세션은 두 버전을 다 보게 된다. 훅은
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
