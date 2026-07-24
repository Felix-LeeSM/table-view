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
- git 은 symlink 를 mode 120000 blob 으로 저장 — macOS/Linux, 그리고 심링크
  권한이 있는 Windows(개발자 모드 또는 관리자) fresh clone 에서는 그대로
  registration 된다. Windows 기본값은 아래 [Windows caveat](#windows-caveat) 참조.
- 새 skill 추가 시 (POSIX 셸 기준):
  `ln -sfn ../../.agents/skills/<name> .claude/skills/<name>`. Windows cmd/
  PowerShell 기본엔 `ln` 이 없고 `core.symlinks` 활성이 필요하다.

## Windows caveat

git 기본값 `core.symlinks=false` (개발자 모드/관리자 아님) 에서는 각 bridge 가
심링크가 아니라 **타겟 경로 텍스트 한 줄을 담은 일반 파일**로 무경고
체크아웃된다. 그러면 `.claude/skills/<name>/SKILL.md` 가 존재하지 않아 위 12개
skill 이 계약 skill(`remember` / `grill-with-memory` / `pr-review`) 포함 전부
**무경고 등록 실패**한다. Windows 는 개발자 모드 + `git config --global
core.symlinks true` 후 재-checkout 해야 bridge 가 심링크로 풀린다.

(근본 해결책인 symlink → thin-wrapper 재설계는 별도 결정 사항 — 여기선 caveat
문서화만.)

## 현재 bridge 목록 (12)

`caveman`, `code-simplification`, `delivery`, `diagnose`, `grill-with-memory`,
`harness`, `improve-codebase-architecture`, `pr-create`, `pr-review`, `remember`,
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
