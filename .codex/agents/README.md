# `.codex/agents/` — Codex agent wrapper

Codex 는 임의의 repo-defined agent 이름 대신 내장 sub-agent role
(`default`, `explorer`, `worker`) 을 제공한다. 이 파일들은 얇은 role
wrapper 이며, repo workflow 를 Codex 내장 role 에 매핑한다.

SOT 는 `memory/` 에 있다. 이 wrapper 는 pointer 일 뿐, 정책 복사본이
아니다. Agent spawn 은 workflow memory 와 현재 실행 환경의 tool policy 를
따른다.

## 매핑

| wrapper | Codex role | 원본 |
|---|---|---|
| `bug-fix` | `worker` | `memory/workflow/bug-fix/memory.md` |
| `tdd-generator` | `worker` | `.agents/skills/tdd/SKILL.md` + testing memory |
| `delivery` | `worker` | `memory/workflow/delivery/memory.md` |
| `research` | `explorer` | `memory/workflow/implementation/memory.md` |
| `pr-reviewer` | `explorer` | `memory/workflow/review/memory.md` |
| `grill-planner` | `default` | `memory/workflow/grill/memory.md` |
| `security-handoff` | `default` | `memory/workflow/grill/security-handoff/memory.md` |
| `codex-reviewer` | `default` | `memory/workflow/review/memory.md` |
| `caveman-default` | `default` | `.agents/skills/caveman/SKILL.md` |

Claude Code path-trigger wrapper 의 rule 은 platform glue 일 뿐이다. 실제
내용은 `memory/` 에 있으므로, Codex 가 path-triggered rules mechanism 을
추가하기 전까지 별도 `.codex/rules/` 복사본은 만들지 않는다.
