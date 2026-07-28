# `.claude/rules/` — Claude Code auto-load rule wrappers

Claude Code 가 working file path 매치 시 자동 로드하는 rule 정의. **본 파일은
thin wrapper** — 본문은 모두 `memory/` 의 source room 으로 redirect.

## 도달 경로

- 상시 로드: 이 `README.md` (frontmatter 없음) + `git-policy.md` (`paths: "**"`).
  나머지 wrapper 는 매칭 파일을 건드릴 때 붙는다.
- `AGENTS.md` 는 wrapper 가 아니라 `CLAUDE.md` 의 `@AGENTS.md` import 로 온다.
  마크다운 링크였을 때는 subagent 에 배달되지 않았다 (#1865 측정).
- 편집 시점에 확실히 닿는 채널은 PostToolUse hook
  (`scripts/hooks/apply/surface-routing.sh`) 의 `memory/` 방 주입 (도달 557 vs
  `nested_memory` 0/512). 룰 본문을 방에 두는 근거다.

## 패턴 (sprint-387 lock)

각 wrapper 는 frontmatter `paths` trigger + 1-3줄 redirect:

```yaml
---
paths:
  - "src-tauri/**/*.rs"
---

# Rust 컨벤션 wrapper

Source: [`memory/engineering/conventions/rust/memory.md`](../../memory/engineering/conventions/rust/memory.md).
```

## 룰

- 본문 **≤ 20줄** (frontmatter 다중 path 때문에 cap 20).
- `paths` glob 보존 — Claude Code 의 auto-load trigger.
- 본문은 source 한 줄 링크 + 필요 시 추가 컨텍스트 (testing 처럼 복수 source).
- 같은 룰 본문이 wrapper 와 source 양쪽에 있으면 안 됨 (drift 위험).

## 현재 wrapper 목록

| wrapper | source |
|---|---|
| `git-policy.md` | `memory/workflow/git-policy/memory.md` |
| `rust-conventions.md` | `memory/engineering/conventions/rust/memory.md` |
| `react-conventions.md` | `memory/engineering/conventions/react/memory.md` |
| `testing.md` | `memory/engineering/conventions/testing-scenarios/memory.md` + `e2e-scenarios/memory.md` |
| `test-scenarios.md` | 위와 동일 (체크리스트 관점) |
| `e2e-scenarios.md` | `memory/engineering/conventions/e2e-scenarios/memory.md` |

## Multi-brain 호환

Codex / Cursor 의 rule 개념 (예: `.cursorrules`, `.codex/rules/`) 도 같은 구조 —
brain 별 wrapper, 본문은 `memory/` source.

## 관련

- `AGENTS.md` — universal entry. `CLAUDE.md` 가 `@` import 로 싣는다
- `memory/engineering/conventions/memory.md` — 코드 룰
- `memory/workflow/git-policy/memory.md` — git hook 회피 금지 source
- `.claude/agents/README.md` — agent wrapper 정책
- `.agents/skills/remember/SKILL.md`, `.agents/skills/split-memory/SKILL.md` — agent skill source
