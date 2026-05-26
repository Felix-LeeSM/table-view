---
title: Agent Skills
type: index
updated: 2026-05-26
---

# Agent Skills

Agent-agnostic skill body source. Brain-specific runtime files stay thin and
redirect here.

## 방 지도

- [caveman](./caveman/SKILL.md) — 초압축 출력 모드
- [code-simplification](./code-simplification/SKILL.md) — 동작 보존 단순화
- [diagnose](./diagnose/SKILL.md) — 버그 / 회귀 진단 루프
- [grill-me](./grill-me/SKILL.md) — 결정 인터뷰
- [grill-with-memory](./grill-with-memory/SKILL.md) — memory 동기화형 grill
- [harness](./harness/SKILL.md) — repo harness workflow runner
- [improve-codebase-architecture](./improve-codebase-architecture/SKILL.md) — architecture deepening
- [remember](./remember/SKILL.md) — 대화 결정 / 룰 저장 (type 매트릭스 + 동작
  6 단계 + reframe / 부분 / 미이동 옵션)
- [split-memory](./split-memory/SKILL.md) — 200줄 초과 `memory.md` 분할
- [sprint-build](./sprint-build/SKILL.md) — sprint 기반 구현
- [tdd](./tdd/SKILL.md) — Red-Green-Refactor

## 진입 규칙

- 본 방에 둘 것: agent-agnostic skill body — 호출 시 agent 가 따를 절차 + 제약
- 본 방에 두지 말 것:
  - 일반 코딩 컨벤션 (→ [conventions](../../memory/conventions/memory.md))
  - 협업 phase 룰 (→ [workflow](../../memory/workflow/memory.md))
  - 실행 시퀀스 (→ [runbook](../../memory/runbook/memory.md))

## 새 skill 추가 시

1. `.agents/skills/<name>/SKILL.md` 작성 — frontmatter `type: skill`
2. `.claude/skills/<name>/SKILL.md`, `.codex/skills/<name>/SKILL.md`,
   `.claude/commands/<name>.md` 같은 brain wrapper 는 redirect 만
3. `/remember` 의 type 매트릭스 와 정합 — `skill` type 사용

## Wrapper 정책

각 skill wrapper 는 frontmatter + 1-3줄 redirect:

```yaml
---
description: <한 줄 — slash command 목록에 표시>
---

# Runtime Wrapper

Source: [`.agents/skills/<name>/SKILL.md`](../../../.agents/skills/<name>/SKILL.md).
```

Slash command wrapper 는 한 단계 덜 내려간다:

```yaml
---
description: <한 줄 — slash command 목록에 표시>
---

# /<name>

Source: [`.agents/skills/<name>/SKILL.md`](../../.agents/skills/<name>/SKILL.md).
```

룰:

- 본문 **≤ 15줄**.
- `description` frontmatter 필수. `name`, `argument-hint` 등 runtime 이 쓰는
  frontmatter 는 wrapper 에 보존.
- **`.claude/commands/` 디렉토리에 README.md 두지 마** — Claude Code 가 디렉토리
  내 모든 `.md` 를 slash command 로 등록한다 (sprint-387 발견). 정책은 본
  `.agents/skills/README.md` 에 둘 것.
- skill body 자체는 `.agents/skills/<name>/SKILL.md` 가 source — wrapper 와 body 가 양쪽에
  있으면 안 됨 (drift).

## Multi-brain 호환

Codex / Cursor 의 slash command 인터페이스도 같은 구조 — brain 별 wrapper,
본문은 `.agents/skills/` source 재사용.

## 관련

- [runbook](../../memory/runbook/memory.md) — 절차 (실행 시퀀스, skill 과 다름)
- [conventions](../../memory/conventions/memory.md) — 코드 룰
