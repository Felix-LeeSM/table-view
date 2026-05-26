---
title: Table View — 팔레스 입구
type: index
updated: 2026-05-17
---

# 팔레스 입구

프로젝트 지식이 주제별 "방"으로 나뉘어 있다. 한 번에 전부 읽지 말고 필요한 방만 내려가자.

## 30초 path (작업 시작 시)

1. 작업 type 식별 — bug-fix / grill / implementation / delivery / refactor / 보안 / 측정?
2. 용어가 애매하면 [terminology](./terminology/memory.md) 로 단어를 먼저 잠근다.
3. [workflow](./workflow/memory.md) 의 phase 매트릭스로 진입 룰 확인.
4. surface (만질 코드 영역) 식별 → [index/by-surface](./index/by-surface.md) 로 관련 SOT 묶음.
5. 같은 작업 패턴이 있었나? → [index/by-task](./index/by-task.md).

## 5분 path

- 작업이 *코드 변경* → [conventions](./conventions/memory.md) (Rust/TS/테스트/주석/refactoring/god-file).
- 작업이 *이름/용어/문구 변경* → [terminology](./terminology/memory.md) (repo-wide language SOT).
- 작업이 *사용자 협업* → [workflow](./workflow/memory.md) (bug-fix / grill / implementation / delivery).
- 작업이 *UX/제품* → [ux](./ux/memory.md).
- 작업이 *측정/절차* → [runbook](./runbook/memory.md).
- 진행 상황 → [roadmap](./roadmap/memory.md).

## 방 지도

- [architecture](./architecture/memory.md) — 기술 스택, 디렉토리 구조, Tauri IPC, Rust 모듈, React 상태 흐름
- [terminology](./terminology/memory.md) — repo-wide 용어 SOT (workflow/domain/UI/tests/agents)
- [conventions](./conventions/memory.md) — Rust/TS 컨벤션, 테스트 규칙, 커밋, 금지 사항
  - [conventions/refactoring](./conventions/refactoring/memory.md) — 리팩토링 코드 작성 기준 (B/D/C/A 4 카테고리, god-file 시퀀스)
  - [conventions/testing-scenarios](./conventions/testing-scenarios/memory.md) — 비-E2E 시나리오 8원칙 (mock-scope sub-room 포함)
  - [conventions/e2e-scenarios](./conventions/e2e-scenarios/memory.md) — E2E 시나리오 설계
  - [conventions/rust](./conventions/rust/memory.md) — Rust 컨벤션 전체 (`.claude/rules/rust-conventions.md` source)
  - [conventions/react](./conventions/react/memory.md) — React/TS 컨벤션 전체 (`.claude/rules/react-conventions.md` source)
- [workflow](./workflow/memory.md) — User-Claude 협업 phase 룰 (bug-fix / grill / implementation / delivery / git-policy)
  - [workflow/git-policy](./workflow/git-policy/memory.md) — hook 회피 금지 (`.claude/rules/git-policy.md` source)
- [ux](./ux/memory.md) — UX 머지 기준 (영속 상태 reset 등)
- [runbook](./runbook/memory.md) — 절차 (cold-boot 측정, multi-agent worktree 등)
  - [runbook/worktree](./runbook/worktree/memory.md) — git worktree 다중 agent 격리 룰
- [skills](./skills/memory.md) — slash command / skill body source
  - [skills/remember](./skills/remember/memory.md) — `/remember` (8 type 매트릭스)
  - [skills/split-memory](./skills/split-memory/memory.md) — `/split-memory` (200줄 분할)
- [roadmap](./roadmap/memory.md) — 현재 Phase 상태, 진행 중 스프린트
- [decisions](./decisions/memory.md) — ADR 이력 (과거 결정, 대체 관계)
- [index/by-task](./index/by-task.md) — 작업 type → 관련 룰/방 묶음 (읽는 자용 cross-link)
- [index/by-surface](./index/by-surface.md) — 코드 surface → 관련 SOT 묶음
- [docs/archives](../docs/archives/README.md) — raw audit / history / old decisions / raw lessons. 기본 read 대상 아님.

## 프로젝트 한줄 요약

Tauri 2 + React 19 + Rust 기반 TablePlus-like 로컬 DB 관리 도구. 다중 DBMS 지원 전제.

## 팔레스 규칙

- 모든 SOT 는 이 repo 안 tracked file 로 존재해야 한다. 채팅, 외부 tool memory,
  GitHub issue/PR comment, agent prompt 는 repo 문서/memory/ADR 로 반영되기 전까지
  SOT 가 아니다.
- Instruction 은 indexable 해야 한다. 새 룰/결정/교훈을 저장할 때는 어떤
  `task`/`surface`/상위 방에서 읽히는지 같이 확인하고, 필요하면 frontmatter 와
  상위 index 를 갱신한다.
- Index 는 entrypoint 이지 충분조건이 아니다. memory 비대화는 좋은 index 만으로
  해결되지 않는다. 같은 주제 반복은 merge, 오래된 실행 계획은 docs/archive 로
  이동, 200줄 위협은 split, 읽힐 경로가 없는 잡음은 저장하지 않는다.
- Raw lesson/history 는 `memory/` 에 두지 않는다. 원문은 `docs/archives/` 에 보존하고,
  반복 적용할 지식만 관련 `workflow` / `conventions` / `runbook` / `ux` 방으로 흡수한다.
- 작업 중 instruction 이 바뀌면 source 를 갱신하고 `bash scripts/regenerate-indexes.sh`
  를 실행한다. 갱신 뒤 실제 workflow/skill/prompt 가 새 위치를 읽는지도 점검한다.
- 각 memory.md는 200줄 이하. 초과 시 `/split-memory`로 하위 주제 분할.
- `memory/` 트리 안에는 `memory.md`와 하위 디렉토리만 허용 (다른 파일명 금지).
- ADR은 3줄 inline 형식 엄수 — 장황하게 쓰지 말 것.
- `docs/` 파일과 내용 중복 금지. 링크로 포인터만.
