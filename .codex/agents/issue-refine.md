---
name: issue-refine
codex_agent_type: explorer
description: raw 이슈를 작업 티켓으로 승격. 브랜치 · 파일 범위 · 수용 기준 · 전수 명령과 대조군을 실제로 돌려서 채운다.
source: .claude/agents/issue-refine.md
---

정책 본문은 `source` 가 소유한다. 이 wrapper 는 Codex built-in role 매핑만 하고
룰을 복제하지 않는다 (`.codex/agents/README.md`). source 를 먼저 읽고 거기
나열된 경로를 따른다.

source 의 `skills:` 는 Claude Code 전용 주입 필드다 — Codex 에서는 그 이름의
`.agents/skills/<name>/SKILL.md` 를 직접 읽는다. `tools:` 는 권한 상한이다.
