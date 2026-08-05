---
title: Table View — 팔레스 입구
type: index
updated: 2026-08-03
keywords: 팔레스, 방 지도, index, by-surface, by-task, 200줄, 12000 chars, wc -m, check-memory-doc-size, doc size cap, lines >, chars >
---

# 팔레스 입구

프로젝트 지식이 주제별 "방"으로 나뉘어 있다. 한 번에 전부 읽지 말고 필요한 방만 내려가자.

## 30초 path (작업 시작 시)

1. 작업 type 식별 — bug-fix / implementation / delivery / refactor / 보안 / 운영 절차?
2. [workflow](./workflow/memory.md) 의 phase 매트릭스로 진입 룰 확인.
3. surface (만질 코드 영역) 식별 → [index/by-surface](./index/by-surface.md) 로 관련 active rule 묶음.
4. 같은 작업 패턴이 있었나? → [index/by-task](./index/by-task.md).

## 5분 path

- 작업이 _코드 변경_ → [engineering/conventions](./engineering/conventions/memory.md) (Rust/TS/테스트/주석/refactoring/god-file).
- 작업이 _사용자 협업_ → [workflow](./workflow/memory.md) (행동 계약).
- 작업이 _제품/UX_ → [product](./product/memory.md).
- 작업이 _운영 절차_ → [runbook](./runbook/memory.md).
- 미래 목표 / 다음 후보 → [docs/ROADMAP.md](../docs/ROADMAP.md).

## 소유권 / SOT

- `memory/memory.md` 는 memory 진입 라우터만 소유한다. 세부 규칙은 각 방의
  `memory.md` 가 소유한다.
- workflow 는 행동 계약만 둔다. 긴 절차는 `.agents/skills/` 에도 있고
  `AGENTS.md` 매트릭스가 그 경로를 준다. 계약이 더 필요하면 memory 를 쪼개서
  여기 적는다.
- 제품 상태와 지원 범위는 [docs/product](../docs/product/README.md) 가 소유한다.
  memory 는 product merge gate 와 agent rule 만 둔다.
- 미래 목표와 sequencing 은 [docs/ROADMAP.md](../docs/ROADMAP.md) 가 소유한다.
  live 실행 상태는 GitHub milestones/issues 가 소유한다.
- Accepted ADR 은 살아 있는 정책이고 `docs/decisions/` 가 소유한다 — 기본 검색에
  잡히고, 뒤집으려면 새 ADR + `Superseded` 다.
- 과거 사건 기록은 기본 memory 탐색 대상이 아니다. 필요할 때만
  `docs/archives/incidents/`, `docs/archives/roadmaps/` 를 historical context 로 본다.

## 방 지도

- [engineering/architecture](./engineering/architecture/memory.md) — 기술 스택, 디렉토리 구조, Tauri IPC, Rust 모듈, React 상태 흐름
- [engineering/conventions](./engineering/conventions/memory.md) — Rust/TS 컨벤션, 테스트 규칙, 커밋, 금지 사항
  - [engineering/conventions/refactoring](./engineering/conventions/refactoring/memory.md) — 리팩토링 코드 작성 기준 (B/D/C/A 4 카테고리, god-file 시퀀스)
  - [engineering/conventions/testing-scenarios](./engineering/conventions/testing-scenarios/memory.md) — 비-E2E 시나리오 9원칙 (mock-scope sub-room 포함)
  - [engineering/conventions/e2e-scenarios](./engineering/conventions/e2e-scenarios/memory.md) — E2E 시나리오 설계
  - [engineering/conventions/rust](./engineering/conventions/rust/memory.md) — Rust 컨벤션 전체
  - [engineering/conventions/react](./engineering/conventions/react/memory.md) — React/TS 컨벤션 전체
- [workflow](./workflow/memory.md) — 사용자-agent 협업 phase 행동 계약
  - [workflow/git-policy](./workflow/git-policy/memory.md) — git 안전 규율 (집행 훅 없음)
- [product](./product/memory.md) — 제품/UX 머지 기준 (영속 상태 reset 등)
- [runbook](./runbook/memory.md) — 절차 (작업 사본 격리 등)
  - [runbook/worktree](./runbook/worktree/memory.md) — 독립 clone 사본 격리 룰 (생성·점유·회수)
- [index/by-task](./index/by-task.md) — 작업 type → 관련 룰/방 묶음 (읽는 자용 cross-link)
- [index/by-surface](./index/by-surface.md) — 코드 surface → 관련 active rule 묶음

## 프로젝트 상태

현재 제품 snapshot, 지원 범위, known limitation 은
[docs/product](../docs/product/README.md) 를 본다. 이 파일에 제품 상태를 복제하지 않는다.

## 팔레스 규칙

- 손작성 active rule 파일은 `memory.md` 만 허용. 각 `memory.md` 는 200줄 이하
  및 12,000 chars 이하 (둘 다 지켜야 함). 어느 하나라도 초과 시 하위 주제로
  방을 쪼갠다.
  - chars 는 **문자 수** (`wc -m`) 다 — byte 수 (`wc -c`) 가 아니다. 한글 본문은
    UTF-8 에서 문자당 3 byte 라 `wc -c` 와 크게 벌어진다. 크기를 인용할 때는
    단위를 함께 적는다.
  - 두 상한은 `bash scripts/check-memory-doc-size.sh` 가 잰다. CI 의 required
    `PR Body Contract` 잡에서 도니까 초과한 채로는 머지가 안 된다 (#2128).
    로컬에서 먼저 돌려라 — 위반은 `FAIL <path>: <실측> lines > 200` 으로 나온다.
- `memory/index/by-task.md`, `memory/index/by-surface.md` 는 cross-link 예외다.
  rule SOT 가 아니다. 손으로 갱신한다 — 방을 추가/삭제하면 by-task 를 갱신하고,
  `surface:` 필드가 있는 방이면 by-surface 도 같이 고친다.
- 새 non-`memory.md` 파일 추가 금지. index 예외 변경은 별도 memory/tooling 결정으로
  다룬다.
- `docs/` 파일과 내용 중복 금지. 링크로 포인터만.
