# `.claude/rules/` — Claude Code auto-load rule wrappers

Claude Code 가 자동 로드하는 rule 정의. **여기는 포인터 자리가 아니라 배달
채널이다** — 본문을 여기 둬야 spawn 된 subagent 에 닿는다.

## 도달 경로 — 실측

`.claude/rules/*.md` 는 **`paths` 선택자가 없거나 매치하면 붙고, 선언했는데 안
매치하면 안 붙는다.** `frontmatter 없음` 과 `paths: ["**"]` 는 두 개의 특례가
아니라 같은 상태의 두 표기다 (#1978 프로브, claude 2.1.220 / haiku, 6칸,
`tool_uses: 0`).

- 무조건 붙는 것: 이 `README.md` (frontmatter 없음) + `git-policy.md`
  (`paths: "**"`). 나머지 넷은 자기 glob 에 매치할 때만이고, **매치할 때 실제로
  붙는지는 아직 안 쟀다** — #1978 은 "매치할 작업이 없는" 음성 조건만 쟀다.
- **마크다운 링크는 안 따라간다. `@` import 는 따라간다.** `AGENTS.md` 는
  wrapper 가 아니라 `CLAUDE.md` 의 `@AGENTS.md` import 로 온다 (#1865 측정).
- 옛 판이 여기에 "`nested_memory` 0/512 라서 룰 본문을 방에 둔다" 를 적었다.
  **그 계량기가 이 채널을 원리적으로 못 본다** — 이 문서들은 attachment 가 아니라
  시스템 프롬프트로 들어가고 트랜스크립트가 그걸 기록하지 않는다. 같은 실행에서
  probe 가 표식을 정확히 인용하는데 attachment 집계는 `hook_success` /
  `hook_additional_context` 둘뿐이었다 (#1978). 0/512 는 도달 실패가 아니라
  계량기 한계였고, 포인터 구조의 근거가 그것이었다.

## 패턴

선택자 없거나 `"**"` 인 wrapper 는 **금지·계약 본문 자체**를 싣는다. 좁은 glob
wrapper 는 해당 surface 를 건드릴 때만 붙으므로 source 링크로 족하다.

```yaml
---
paths:
  - "src-tauri/**/*.rs"
---

# Rust 컨벤션 wrapper

Source: [`memory/engineering/conventions/rust/memory.md`](../../memory/engineering/conventions/rust/memory.md).
```

## 룰

- **cap 은 `wc -l` 이 세는 파일 전체 줄수다. frontmatter 를 포함하고 README.md
  는 제외한다.** `.claude/rules` 는 ≤ 30. 근거와 다른 디렉토리 값은
  `scripts/hooks/policy/check-wrapper-cap.sh` 헤더가 소유한다.
- cap 의 역할은 "포인터임을 강제" 가 아니라 **채널 예산**이다 — 여기 있는 줄은
  전부 모든 subagent 의 시스템 프롬프트에 실린다.
- `paths` glob 보존 — auto-load trigger 다.
- 본문을 손으로 복제하지 않는다. 싣더라도 **SOT 에서 파생하고 drift 검사를
  붙인다** (예: `git-policy.md` 의 차단 목록 ↔
  `scripts/hooks/policy/check-agent-reach.sh`, pre-push 의 agent/hook 경로).

## 현재 wrapper 목록

| wrapper | 붙는 조건 | 본문 |
|---|---|---|
| `git-policy.md` | 무조건 (`paths: "**"`) | 차단 목록 자체. SOT `scripts/hooks/policy/check-dangerous-bash.sh` 에서 파생 |
| `rust-conventions.md` | `src-tauri/**/*.rs` | `memory/engineering/conventions/rust/memory.md` 링크 |
| `react-conventions.md` | `src/**/*.{ts,tsx}` | `memory/engineering/conventions/react/memory.md` 링크 |
| `testing.md` | `**/*.rs`, `**/*.{ts,tsx}`, `e2e/**` | testing-scenarios + e2e-scenarios 링크 |
| `test-scenarios.md` | `**/*.{ts,tsx,rs}` | 위와 동일 (체크리스트 관점) |
| `e2e-scenarios.md` | `e2e/**` | `memory/engineering/conventions/e2e-scenarios/memory.md` 링크 |

## Multi-brain 호환

Codex / Cursor 에는 path-triggered rules 기전이 없다. 그래서 `.codex/rules/`
사본을 두지 않고, 그쪽은 `.codex/agents/*.md` 의 `source` 포인터로 같은 본문에
닿는다.

## 관련

- `AGENTS.md` — universal entry. `CLAUDE.md` 가 `@` import 로 싣는다
- `memory/workflow/git-policy/memory.md` — 절차와 근거 SOT
- `.claude/agents/README.md` — agent wrapper 정책과 `skills:` 주입 실측
- `.agents/skills/remember/SKILL.md`, `.agents/skills/split-memory/SKILL.md` — agent skill source
