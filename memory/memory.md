---
title: Table View — 팔레스 입구
type: index
updated: 2026-04-22
---

# 팔레스 입구

프로젝트 지식이 주제별 "방"으로 나뉘어 있다. 한 번에 전부 읽지 말고 필요한 방만 내려가자.

## 방 지도

- [architecture](./architecture/memory.md) — 기술 스택, 디렉토리 구조, Tauri IPC, Rust 모듈, React 상태 흐름
- [conventions](./conventions/memory.md) — Rust/TS 컨벤션, 테스트 규칙, 커밋, 금지 사항
  - [conventions/refactoring](./conventions/refactoring/memory.md) — 리팩토링 코드 작성 기준 (B/D/C/A 4 카테고리)
- [roadmap](./roadmap/memory.md) — 현재 Phase 상태, 진행 중 스프린트
- [decisions](./decisions/memory.md) — ADR 이력 (과거 결정, 대체 관계)
- [lessons](./lessons/memory.md) — 실패·성공 교훈

## 프로젝트 한줄 요약

Tauri 2 + React 19 + Rust 기반 TablePlus-like 로컬 DB 관리 도구. 다중 DBMS 지원 전제.

## 팔레스 규칙

- 각 memory.md는 200줄 이하. 초과 시 `/split-memory`로 하위 주제 분할.
- `memory/` 트리 안에는 `memory.md`와 하위 디렉토리만 허용 (다른 파일명 금지).
- ADR/Lesson은 3줄 inline 형식 엄수 — 장황하게 쓰지 말 것.
- `docs/` 파일과 내용 중복 금지. 링크로 포인터만.
