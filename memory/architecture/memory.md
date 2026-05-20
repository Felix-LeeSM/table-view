---
title: Architecture
type: memory
updated: 2026-05-20
---

# 시스템 구조

상세 설계: [docs/architecture.md](../../docs/architecture.md). 여기는 AI 탐색용 요약.

## 기술 스택

| 영역 | 기술 |
|------|------|
| Desktop Framework | Tauri 2.0 |
| Frontend | React 19 + TypeScript 5 (strict) |
| State Management | Zustand |
| Styling | Tailwind CSS 4 (다크 모드 지원 필수) |
| Backend | Rust (Tauri commands) |
| DB Drivers | sqlx (PostgreSQL / MySQL), mongodb |
| App Storage | SQLite via sqlx |
| Build Tool | Vite 6 (frontend), Cargo (backend) |
| Testing | Vitest (frontend), cargo test (backend), Playwright (e2e) |

## 디렉토리 구조

```
table-view/
├── src-tauri/           # Rust 백엔드
│   ├── src/
│   │   ├── main.rs      # Tauri 진입점
│   │   ├── db/          # DB driver 추상화 (trait DbAdapter)
│   │   ├── commands/    # Tauri IPC 명령 핸들러
│   │   ├── storage/     # 연결 설정 I/O + 암호화
│   │   ├── models/      # 데이터 모델 (struct)
│   │   └── error.rs     # 공통 에러 타입 (AppError)
│   └── tests/           # 통합 테스트
├── src/                 # React 프론트엔드
│   ├── components/      # UI 컴포넌트 (PascalCase, 1파일=1컴포넌트)
│   ├── hooks/           # 커스텀 훅
│   ├── stores/          # Zustand 스토어 (camelCase)
│   ├── pages/           # 페이지 단위 컴포넌트
│   ├── lib/             # 유틸리티
│   └── types/           # TypeScript 타입
├── e2e/                 # Playwright E2E
└── docs/                # 프로젝트 문서 (PLAN, RISKS, phases)
```

## 계층

- **Rust 백엔드** (`src-tauri/src/`) — Tauri IPC commands, DbAdapter trait, storage
- **React 프론트엔드** (`src/`) — Zustand stores, components, hooks
- **IPC 경계** — `#[tauri::command]` 함수가 프론트 `invoke()` 호출 진입점

## Rust 주요 모듈

- `commands/` — IPC 핸들러 (connection, query, schema)
- `db/` — ActiveAdapter + paradigm trait + 사용자 DB 구현체 (PostgreSQL, MySQL,
  MongoDB)
- `storage/` — 연결 설정 파일 I/O + 암호화 (AES-256-GCM, OsRng)
- `models/` — 공용 구조체 (ConnectionConfig, ConnectionGroup, DatabaseType 등)
- `error.rs` — `AppError` (thiserror) + `Result<T, AppError>`

## Frontend 상태 관리

- Zustand store 파일: `src/stores/`
- 주요 store: `connectionStore`, `workspaceStore`, `schemaStore`, `favoritesStore`,
  `mruStore`, `themeStore`, `safeModeStore`.
- `connectionStore.focusedConnId` 는 launcher/connection-list focus 용도다.
  workspace 작업 identity 는 window label 의 `workspace-{connection_id}` +
  active db 로부터 `(connId, db)` 를 만들고, `workspaceStore` 가 그 key 로 tab /
  sidebar state 를 소유한다. 상세 결정: [decisions/0027](../decisions/0027-per-workspace-state-store/memory.md),
  [decisions/0039](../decisions/0039-workspace-window-per-connection/memory.md)

## 데이터 흐름

1. 사용자 UI 조작 → component/hook/store → `src/lib/tauri/**` domain wrapper
2. Wrapper → `invoke("command_name", args)` typed request/response
3. Rust command → `ActiveAdapter` paradigm gate → adapter/storage/state method
4. `Result<T, AppError>` 반환 → wrapper post-processing → store/UI 반영

## 관련 방

- [paradigms](paradigms/memory.md) — Phase 7(ES) · Phase 8(Redis) UI slot 비교 + 일급 개념 대조 + 결정 이력
- [decisions](../decisions/memory.md) — 구조 결정 이력
- [roadmap](../roadmap/memory.md) — 어느 모듈이 어느 Phase에 확장되는지
- [conventions](../conventions/memory.md) — Rust/TS 코딩 규칙, 테스트, 커밋
