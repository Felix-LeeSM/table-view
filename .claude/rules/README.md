# `.claude/rules/` — Claude Code auto-load rule wrappers

Claude Code 가 working file path 매치 시 자동 로드하는 rule 정의. **본 파일은
thin wrapper** — 본문은 모두 `memory/` 의 source room 으로 redirect.

## 패턴 (sprint-387 lock)

각 wrapper 는 frontmatter `paths` trigger + 1-3줄 redirect:

```yaml
---
paths:
  - "src-tauri/**/*.rs"
---

# Rust 컨벤션 wrapper

Source: [`memory/conventions/rust/memory.md`](../../memory/conventions/rust/memory.md).
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
| `rust-conventions.md` | `memory/conventions/rust/memory.md` |
| `react-conventions.md` | `memory/conventions/react/memory.md` |
| `testing.md` | `memory/conventions/testing-scenarios/memory.md` + `e2e-scenarios/memory.md` |
| `test-scenarios.md` | 위와 동일 (체크리스트 관점) |
| `e2e-scenarios.md` | `memory/conventions/e2e-scenarios/memory.md` |

## Multi-brain 호환

Codex / Cursor 의 rule 개념 (예: `.cursorrules`, `.codex/rules/`) 도 같은 구조 —
brain 별 wrapper, 본문은 `memory/` source.

## 관련

- `AGENTS.md` — universal entry
- `memory/conventions/memory.md` — 코드 룰
- `memory/workflow/git-policy/memory.md` — git hook 회피 금지 source
- `.claude/agents/README.md` — agent wrapper 정책
- `.agents/skills/README.md` — slash command wrapper 정책 (commands/ README 금지 룰)
