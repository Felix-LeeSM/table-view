---
title: Table View — 팔레스 입구
type: index
updated: 2026-05-17
---

# 팔레스 입구

프로젝트 지식이 주제별 "방"으로 나뉘어 있다. 한 번에 전부 읽지 말고 필요한 방만 내려가자.

## 30초 path (작업 시작 시)

1. 작업 type 식별 — bug-fix / implementation / delivery / refactor / 보안 / 운영 절차?
2. [workflow](./workflow/memory.md) 의 phase 매트릭스로 진입 룰 확인.
3. surface (만질 코드 영역) 식별 → [index/by-surface](./index/by-surface.md) 로 관련 active rule 묶음.
4. 같은 작업 패턴이 있었나? → [index/by-task](./index/by-task.md).

## 5분 path

- 작업이 *코드 변경* → [engineering/conventions](./engineering/conventions/memory.md) (Rust/TS/테스트/주석/refactoring/god-file).
- 작업이 *사용자 협업* → [workflow](./workflow/memory.md) (bug-fix / implementation / delivery).
- 작업이 *제품/UX* → [product](./product/memory.md).
- 작업이 *운영 절차* → [runbook](./runbook/memory.md).
- 미래 목표 / 다음 후보 → [docs/ROADMAP.md](../docs/ROADMAP.md).

## 방 지도

- [engineering/architecture](./engineering/architecture/memory.md) — 기술 스택, 디렉토리 구조, Tauri IPC, Rust 모듈, React 상태 흐름
- [engineering/conventions](./engineering/conventions/memory.md) — Rust/TS 컨벤션, 테스트 규칙, 커밋, 금지 사항
  - [engineering/conventions/refactoring](./engineering/conventions/refactoring/memory.md) — 리팩토링 코드 작성 기준 (B/D/C/A 4 카테고리, god-file 시퀀스)
  - [engineering/conventions/testing-scenarios](./engineering/conventions/testing-scenarios/memory.md) — 비-E2E 시나리오 8원칙 (mock-scope sub-room 포함)
  - [engineering/conventions/e2e-scenarios](./engineering/conventions/e2e-scenarios/memory.md) — E2E 시나리오 설계
  - [engineering/conventions/rust](./engineering/conventions/rust/memory.md) — Rust 컨벤션 전체 (`.claude/rules/rust-conventions.md` source)
  - [engineering/conventions/react](./engineering/conventions/react/memory.md) — React/TS 컨벤션 전체 (`.claude/rules/react-conventions.md` source)
- [workflow](./workflow/memory.md) — User-Claude 협업 phase 룰 (bug-fix / implementation / delivery / git-policy)
  - [workflow/git-policy](./workflow/git-policy/memory.md) — hook 회피 금지 (`.claude/rules/git-policy.md` source)
- [product](./product/memory.md) — 제품/UX 머지 기준 (영속 상태 reset 등)
- [runbook](./runbook/memory.md) — 절차 (multi-agent worktree 등)
  - [runbook/worktree](./runbook/worktree/memory.md) — git worktree 다중 agent 격리 룰
- 결정 / grill 은 memory workflow 가 아니라 `.agents/skills/grill-me/SKILL.md`
  또는 `.agents/skills/grill-with-memory/SKILL.md` 를 따른다.
  보안 결정도 `grill-me` skill 의 보안 결정 섹션을 따른다.
- [index/by-task](./index/by-task.md) — 작업 type → 관련 룰/방 묶음 (읽는 자용 cross-link)
- [index/by-surface](./index/by-surface.md) — 코드 surface → 관련 active rule 묶음

과거 결정과 사건 기록은 기본 memory 탐색 대상이 아니다. 필요할 때만
`docs/archives/decisions/`, `docs/archives/incidents/`,
`docs/archives/roadmaps/` 를 historical context 로 본다.

## 프로젝트 한줄 요약

Tauri 2 + React 19 + Rust 기반 TablePlus-like 로컬 DB 관리 도구. 다중 DBMS 지원 전제.

## 팔레스 규칙

- 각 memory.md는 200줄 이하. 초과 시 `split-memory` skill 로 하위 주제 분할.
- `memory/` 트리 안에는 `memory.md`와 하위 디렉토리만 허용 (다른 파일명 금지).
- `docs/` 파일과 내용 중복 금지. 링크로 포인터만.
