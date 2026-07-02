# `.claude/skills/` — Claude Code skill discovery bridge

Claude Code 는 skill 을 `~/.claude/skills/` (user-global) 과 프로젝트
`.claude/skills/` 에서만 auto-discover 한다. 이 repo 의 skill SOT 는
`.agents/skills/<name>/SKILL.md` 에 있으므로, 여기 각 항목은 **생성된 bridge** —
본문 없이 SOT 를 가리키는 relative symlink 다.

## 패턴 (issue #1021)

각 항목은 `.agents/skills/<name>` 로 향하는 relative symlink:

```
.claude/skills/remember -> ../../.agents/skills/remember
```

- SOT 는 항상 `.agents/skills/<name>/SKILL.md`. 여기서 편집하지 않는다.
- Symlink 라 drift 불가능 — SOT 1개, 사본 0개.
- git 은 symlink 를 그대로 저장하므로 fresh clone 에서도 registration 된다.
- 새 skill 추가 시: `ln -sfn ../../.agents/skills/<name> .claude/skills/<name>`.

## 현재 bridge 목록 (11)

`caveman`, `code-simplification`, `diagnose`, `grill-with-memory`, `harness`,
`improve-codebase-architecture`, `pr-create`, `pr-review`, `remember`,
`split-memory`, `tdd`.

`.agents/skills/*/SKILL.md` 와 1:1. skill 추가/삭제 시 이 브리지도 맞춘다.

## Multi-brain 호환

`.claude/rules/` 와 같은 wrapper 철학 — brain(Claude Code)이 요구하는 위치에
bridge 만 두고 본문은 `.agents/` universal SOT. Codex / Cursor 는 각자의
discovery 경로에서 같은 `.agents/skills/` SOT 를 가리키면 된다.

## 관련

- `AGENTS.md` — universal entry, skill contract (`remember` / `grill-with-memory` / `pr-review`)
- `.agents/skills/` — skill 본문 SOT
- `.claude/rules/README.md` — 같은 thin-wrapper/bridge 패턴 (rule 용)
