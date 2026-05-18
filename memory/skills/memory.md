---
title: Skills
type: index
updated: 2026-05-18
---

# Skills

Slash command / skill body source. `.claude/commands/<name>.md` 가 본 디렉토리의
방을 redirect. Codex / Cursor 등 다른 brain 도 동일 source 사용.

## 방 지도

- [remember](./remember/memory.md) — 대화 결정 / 룰 저장 (8 type 매트릭스 + 동작
  6 단계 + reframe / 부분 / 미이동 옵션)
- [split-memory](./split-memory/memory.md) — 200줄 초과 `memory.md` 분할

## 진입 규칙

- 본 방에 둘 것: slash command body — 호출 시 agent 가 따를 절차 + 제약
- 본 방에 두지 말 것:
  - 일반 코딩 컨벤션 (→ [conventions](../conventions/memory.md))
  - 협업 phase 룰 (→ [workflow](../workflow/memory.md))
  - 실행 시퀀스 (→ [runbook](../runbook/memory.md))

## 새 skill 추가 시

1. `memory/skills/<name>/memory.md` 작성 — frontmatter `type: skill`
2. `.claude/commands/<name>.md` wrapper — `description` frontmatter + 1-3줄 redirect
3. `/remember` 의 type 매트릭스 와 정합 — `skill` type 사용

## Wrapper 정책 (Claude Code `.claude/commands/*.md`)

각 wrapper 는 frontmatter `description` + 1-3줄 redirect:

```yaml
---
description: <한 줄 — slash command 목록에 표시>
---

# /<name>

Source: [`memory/skills/<name>/memory.md`](../../memory/skills/<name>/memory.md).
```

룰:

- 본문 **≤ 15줄**.
- `description` frontmatter 필수.
- **`.claude/commands/` 디렉토리에 README.md 두지 마** — Claude Code 가 디렉토리
  내 모든 `.md` 를 slash command 로 등록한다 (sprint-387 발견). 정책은 본 방
  (memory/skills/memory.md) 에 둘 것.
- skill body 자체는 본 방의 sub-room 이 source — wrapper 와 body 가 양쪽에
  있으면 안 됨 (drift).

## Multi-brain 호환

Codex / Cursor 의 slash command 인터페이스도 같은 구조 — brain 별 wrapper,
본문은 `memory/skills/` source 재사용.

## 관련

- [runbook](../runbook/memory.md) — 절차 (실행 시퀀스, skill 과 다름)
- [conventions](../conventions/memory.md) — 코드 룰
