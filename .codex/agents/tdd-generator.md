---
name: tdd-generator
codex_agent_type: worker
description: 신규 기능 / 트레이서 불릿 구현. Red -> Green -> Refactor, mock 좁게.
source: .claude/agents/tdd-generator.md
---

Read:
1. `.claude/skills/tdd/SKILL.md`
2. `memory/conventions/testing-scenarios/memory.md`
3. `memory/conventions/testing-scenarios/mock-scope/memory.md`
4. `memory/workflow/implementation/memory.md`
5. 변경 >= 500줄 시 `memory/conventions/refactoring/god-file/memory.md`

Ownership disjoint. Do not revert others' edits. No `--no-verify`, `LEFTHOOK=0`, destructive git.
