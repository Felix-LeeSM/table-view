---
title: Architecture
type: memory
updated: 2026-04-22
---

# 시스템 구조

상세 설계: [docs/architecture.md](../../docs/architecture.md). 여기는 AI 탐색용 요약.

## 계층

- **Rust 백엔드** (`src-tauri/src/`) — Tauri IPC commands, DbAdapter trait, storage
- **React 프론트엔드** (`src/`) — Zustand stores, components, hooks
- **IPC 경계** — `#[tauri::command]` 함수가 프론트 `invoke()` 호출 진입점

## Rust 주요 모듈

- `commands/` — IPC 핸들러 (connection, query, schema)
- `db/` — DbAdapter trait + 구현체 (postgres 구현 완료, mysql/sqlite 예정)
- `storage/` — 연결 설정 파일 I/O + 암호화 (AES-256-GCM, OsRng)
- `models/` — 공용 구조체 (ConnectionConfig, ConnectionGroup, DatabaseType 등)
- `error.rs` — `AppError` (thiserror) + `Result<T, AppError>`

## Frontend 상태 관리

- Zustand store 파일: `src/stores/`
- 주요 store: `connectionStore`, `tabStore`, `favoritesStore`
- `connectionStore`는 `focusedConnId`(전역 현재 선택) 보유 — Sidebar 로컬 state가 아님.
  상세 결정: [decisions/0003](../decisions/0003-multi-connection-focused-id/memory.md)

## 데이터 흐름

1. 사용자 UI 조작 → store action → `invoke("command_name", args)`
2. Rust command → DbAdapter 메서드 호출 → `Result` 반환
3. store 상태 업데이트 → 컴포넌트 리렌더

## 관련 방

- [decisions](../decisions/memory.md) — 구조 결정 이력
- [roadmap](../roadmap/memory.md) — 어느 모듈이 어느 Phase에 확장되는지
