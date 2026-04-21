# Table View — Claude Code 프로젝트 가이드

## 프로젝트 개요

Table View는 Tauri 2.0 + React + Rust 기반의 TablePlus-like 데이터베이스 관리 도구입니다.
데스크톱 앱으로, 다중 DBMS(PostgreSQL, MySQL, SQLite, MongoDB 등)를 지원합니다.

## 먼저 읽을 곳

상세 지식은 **메모리 팔레스**에 주제별로 나뉘어 있다. 작업 시작 전 필요한 방만 읽는다.

- **[`memory/memory.md`](memory/memory.md)** — 팔레스 입구, 방 지도.
  - [`memory/architecture/memory.md`](memory/architecture/memory.md) — 기술 스택, 디렉토리 구조, IPC·상태 흐름
  - [`memory/conventions/memory.md`](memory/conventions/memory.md) — Rust/TS 컨벤션, 테스트 규칙, 커밋, 금지 사항
  - [`memory/roadmap/memory.md`](memory/roadmap/memory.md) — 현재 Phase 상태
  - [`memory/decisions/memory.md`](memory/decisions/memory.md) — ADR 이력
  - [`memory/lessons/memory.md`](memory/lessons/memory.md) — 교훈

## 프로젝트 문서

- **[`docs/PLAN.md`](docs/PLAN.md)** — 마스터 플랜. 모든 구현 결정은 "TablePlus 사용자가 핵심 워크플로우에서 끊김 없이 전환 가능한가?" 기준으로 판단.
- **[`docs/RISKS.md`](docs/RISKS.md)** — 잔여 위험 등록부. `active`/`resolved`/`deferred` 상태 추적.

## 메모리 팔레스 규칙 (강제)

- `memory/` 트리는 **오직 `memory.md`만** 허용. 하위 주제는 디렉토리로 분기하고 다시 `memory.md`.
- 한 파일 **200줄 이하**. 초과 시 `/split-memory`로 분할.
- **ADR 본문은 작성 순간 동결** — 결정/이유/트레이드오프 수정 금지. 프론트매터 메타 필드(`status`, `superseded_by`)만 갱신 가능. 결정을 뒤집으려면 새 ADR을 추가하고 원본 상태를 `Superseded`로 전이.
- 대화에서 배운 결정·교훈은 `/remember`로 적절한 방에 저장.
