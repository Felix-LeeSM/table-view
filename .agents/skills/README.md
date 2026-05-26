---
title: Agent Skills
type: index
updated: 2026-05-26
---

# Agent Skills

브레인 공통 skill 본문 원본. 이 repo 에 브레인별 skill 복사본은 두지 않는다.
실행 agent 는 이 디렉토리를 직접 읽거나 `AGENTS.md` / 명령 wrapper 에서 명시
링크를 받는다.

## 방 지도

- [caveman](./caveman/SKILL.md) — 초압축 출력 모드
- [code-simplification](./code-simplification/SKILL.md) — 동작 보존 단순화
- [diagnose](./diagnose/SKILL.md) — 버그 / 회귀 진단 루프
- [grill-me](./grill-me/SKILL.md) — 결정 인터뷰
- [grill-with-memory](./grill-with-memory/SKILL.md) — memory 동기화형 grill
- [harness](./harness/SKILL.md) — repo harness workflow 실행기
- [improve-codebase-architecture](./improve-codebase-architecture/SKILL.md) — architecture 심화
- [remember](./remember/SKILL.md) — 대화 결정 / 룰 저장 (type 매트릭스 + 동작
  6 단계 + 재해석 / 부분 저장 / 미이동 옵션)
- [split-memory](./split-memory/SKILL.md) — 200줄 초과 `memory.md` 분할
- [sprint-build](./sprint-build/SKILL.md) — sprint 기반 구현
- [tdd](./tdd/SKILL.md) — Red-Green-Refactor

## 진입 규칙

- 본 방에 둘 것: 브레인 공통 skill 본문 — 호출 시 agent 가 따를 절차 + 제약
- 본 방에 두지 말 것:
  - 일반 코딩 컨벤션 (→ [conventions](../../memory/conventions/memory.md))
  - 협업 phase 룰 (→ [workflow](../../memory/workflow/memory.md))
  - 실행 시퀀스 (→ [runbook](../../memory/runbook/memory.md))

## 새 skill 추가 시

1. `.agents/skills/<name>/SKILL.md` 작성 — frontmatter `name`, `description`
   필수.
2. `.claude/skills/<name>/SKILL.md`, `.codex/skills/<name>/SKILL.md` 같은
   브레인별 skill 복사본은 만들지 않는다.
3. 슬래시 명령이 필요할 때만 `.claude/commands/<name>.md` wrapper 를 둔다.
4. `/remember` 의 type 매트릭스 와 정합 — `skill` type 사용

## 슬래시 명령 wrapper 정책

슬래시 명령 wrapper 는 frontmatter + 1-3줄 redirect:

```yaml
---
description: <한 줄 — slash command 목록에 표시>
---

# /<name>

원본: [`.agents/skills/<name>/SKILL.md`](../../.agents/skills/<name>/SKILL.md).
```

룰:

- 본문 **≤ 15줄**.
- `description` frontmatter 필수. `name`, `argument-hint` 등 실행 환경이 쓰는
  frontmatter 는 wrapper 에 보존.
- **`.claude/commands/` 디렉토리에 README.md 두지 마** — Claude Code 가 디렉토리
  내 모든 `.md` 를 slash command 로 등록한다 (sprint-387 발견). 정책은 본
  `.agents/skills/README.md` 에 둘 것.
- skill body 자체는 `.agents/skills/<name>/SKILL.md` 가 원본 — 브레인별 skill
  복사본을 만들면 안 됨 (drift / duplicate load).

## Multi-brain 호환

Codex / Cursor 에서도 본문은 `.agents/skills/` 원본을 재사용한다. 브레인별
skill directory copy 는 금지한다.

## 관련

- [runbook](../../memory/runbook/memory.md) — 절차 (실행 시퀀스, skill 과 다름)
- [conventions](../../memory/conventions/memory.md) — 코드 룰
