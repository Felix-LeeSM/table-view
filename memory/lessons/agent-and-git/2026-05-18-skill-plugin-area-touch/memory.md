---
title: Skill plugin 영역 침범 — anti-pattern (sprint-388)
type: lesson
updated: 2026-05-18
task: review, plugin, skill, sprint-388
surface: .claude/skills, memory/workflow/review
---

# Skill plugin 영역 침범

**상황**: sprint-388 작업 중 `.claude/skills/harness/prompts/evaluator.md` 의
본문을 deprecate + redirect 로 갈아끼우려 했음. 사용자 지적 — skill 은 plugin
시스템, repo 가 수정하면 plugin update 시 충돌.

**원인**: sprint-387 의 evaluator wrapper 가 `.claude/skills/harness/prompts/
evaluator.md` 를 read 대상으로 가리키던 인식 — repo 의 review agent 룰과
harness skill 의 evaluator 룰이 같은 것으로 착각. 실제로는 *직교* — repo 룰은
`memory/workflow/review/memory.md`, skill 룰은 plugin 자체.

**재발 방지**:
- repo 가 `.claude/skills/<x>/` 의 파일을 *절대* 수정 안 함.
- 본 sprint 의 review agent wrapper 는 `memory/workflow/review/memory.md` 만
  가리킴, harness skill 의 evaluator prompt 는 가리키지 않음.
- 정합성 차원 (`memory/workflow/review/memory.md`) 의 sub-checklist 에 "외부
  plugin / skill 영역 침범" 추가.
- `.claude/settings.json` PreToolUse Edit|Write 에 hard block 등록 — `.claude/
  skills/**` 매치 시 stderr 차단.
- repo 의 review agent 이름을 `evaluator` → `pr-reviewer` 로 rename
  (sprint-388 후속). harness skill 의 `evaluator` prompt 와 명확히 구분.

## 일반화 — 외부 영역 카탈로그

본 repo 가 수정하면 안 되는 영역:

- `.claude/skills/<x>/` — Claude Code skill plugin
- `.claude/plugins/<x>/` (있다면) — plugin 일반
- `node_modules/`, `src-tauri/target/`, `vendor/` — 외부 SDK / 빌드 산출물
- `.claude/settings.local.json`, `.env*` — gitignored / user-local
- `worktrees/`, `.claude/worktrees/` — runtime 인스턴스 격리

## 관련

- `memory/workflow/review/memory.md` — 정합성 차원의 침범 카테고리
- `.claude/settings.json` — PreToolUse hard block
