---
title: Architecture
type: memory
updated: 2026-08-01
keywords: 기술 스택, 디렉토리 구조, Tauri 2.0, React 19, Zustand, IPC 경계, tauri::command, invoke(), ActiveAdapter, DbAdapter, AppError::DbMismatch, src/lib/runtime/**, table-view-core, path dependency, headless core
---

# 시스템 구조

레거시 설계 snapshot:
[docs/archives/design-snapshots/architecture-legacy.md](../../../docs/archives/design-snapshots/architecture-legacy.md).
현재 AI 탐색용 요약은 이 memory가 SOT.

## 기술 스택

| 영역              | 기술                                                      |
| ----------------- | --------------------------------------------------------- |
| Desktop Framework | Tauri 2.0                                                 |
| Frontend          | React 19 + TypeScript 5 (strict)                          |
| State Management  | Zustand                                                   |
| Styling           | Tailwind CSS 4 (다크 모드 지원 필수)                      |
| Backend           | Rust (Tauri commands)                                     |
| DB Drivers        | sqlx (PostgreSQL / MySQL / MariaDB / SQLite), DuckDB, mongodb, redis/valkey, live HTTP Search adapters for Elasticsearch/OpenSearch |
| App Storage       | SQLite via sqlx                                           |
| Build Tool        | Vite 6 (frontend), Cargo (backend)                        |
| Testing           | Vitest (frontend), cargo test (backend), WebdriverIO + tauri-driver (e2e) |

## 디렉토리 구조

```
table-view/
├── src-tauri/                # Rust 백엔드 — crate 둘 (#1769)
│   ├── src/                  # 앱 crate `table-view` (Tauri 의존)
│   │   ├── main.rs           # Tauri 진입점
│   │   ├── commands/         # Tauri IPC 명령 핸들러
│   │   ├── state/            # 프로세스 수명 런타임 상태
│   │   └── storage/          # boot 글루만 (history audit / retention)
│   ├── table-view-core/src/  # 코어 crate — path dep, Tauri 비의존
│   │   ├── db/               # DB lifecycle + paradigm adapter traits
│   │   ├── storage/          # 연결 설정 I/O + 암호화
│   │   ├── models/           # 데이터 모델 (struct)
│   │   └── error.rs          # 공통 에러 타입 (AppError)
│   └── tests/                # 통합 테스트 (앱 crate 소속)
├── src/                 # React 프론트엔드
│   ├── components/      # UI 컴포넌트 (PascalCase, 1파일=1컴포넌트)
│   ├── hooks/           # 커스텀 훅
│   ├── stores/          # Zustand 스토어 (camelCase)
│   ├── pages/           # 페이지 단위 컴포넌트
│   ├── lib/             # pure/domain helpers + boundary wrappers; runtime exception below
│   └── types/           # TypeScript 타입
├── e2e/                 # WebdriverIO + tauri-driver E2E
└── docs/                # 사람용 프로젝트 문서 (product, roadmap, phases, archives)
```

## 계층

- **Rust 백엔드** — 앱 crate (`src-tauri/src/`) 가 Tauri IPC commands · state ·
  boot 글루를, 코어 crate (`src-tauri/table-view-core/`) 가 adapter traits ·
  storage · models · error 를 갖는다. 앱이 `db` / `models` / `error` 를
  re-export 하므로 `crate::db::…` 경로는 분리 전 그대로다
- **React 프론트엔드** (`src/`) — Zustand stores, components, hooks
- **IPC 경계** — `#[tauri::command]` 함수가 프론트 `invoke()` 호출 진입점

## Rust 주요 모듈

앱 crate — `src-tauri/src/`:

- `commands/` — IPC 핸들러 (connection, query, schema)
- `state/` — 프로세스 수명 런타임 상태 (introspection pool 등)
- `storage/` — boot 글루 `history_audit` · `history_retention_boot` 뿐. 저장소
  본체는 아래 core 다 (`crate::commands::` 역참조 때문에 못 내려왔다)

코어 crate — `src-tauri/table-view-core/src/`:

- `db/` — `ActiveAdapter` + common `DbAdapter` lifecycle + paradigm traits
  (`RdbAdapter`, `DocumentAdapter`, `KvAdapter`, `SearchAdapter`) + 사용자 DB
  구현체 (PostgreSQL, MySQL/MariaDB, SQLite, DuckDB, MongoDB, Redis/Valkey,
  Elasticsearch/OpenSearch)
- `storage/` — 연결 설정 파일 I/O + 암호화 (AES-256-GCM, OsRng)
- `models/` — 공용 구조체 (ConnectionConfig, ConnectionGroup, DatabaseType 등)
- `error.rs` — `AppError` (thiserror) + `Result<T, AppError>`

core 는 Tauri 에 의존하지 않는 것이 계약이다 — `cargo tree -i tauri` 가 빈
결과여야 하고, 그래서 workspace member 가 아니라 path dependency 다. **그래서
테스트 명령이 manifest 하나로 안 닫힌다** — `src-tauri/Cargo.toml` 의 `--lib` 은
core 에 안 닿고, 빠져도 exit 0 이다. 돌려야 하는 목록의 SOT 는
`docs/contributor-guide/testing-and-quality.md` 의 Pre-Release Verification Gate
Rust lane 이고, CI 도 같은 이유로 그 명령들을 `Rust Unit And Storage Tests` 잡의
스텝으로 나눠 건다.

## Frontend 상태 관리

- Zustand store 파일: `src/stores/`
- 주요 store: `connectionStore`, `workspaceStore`, `schemaStore`, `favoritesStore`,
  `mruStore`, `themeStore`, `safeModeStore`, `toastStore`.
- `connectionStore.focusedConnId` 는 launcher/connection-list focus 용도다.
  workspace 작업 identity 는 window label 의 `workspace-{connection_id}` +
  active db 로부터 `(connId, db)` 를 만들고, `workspaceStore` 가 그 key 로 tab /
  sidebar state 를 소유한다.

## 데이터 흐름

1. 사용자 UI 조작 → component/hook → store action 또는 `src/lib/runtime/**`
   use-case → `src/lib/tauri/**` domain wrapper
2. Wrapper → `invoke("command_name", args)` typed request/response
3. Rust command → `ActiveAdapter` paradigm gate → adapter/storage/state method
4. `Result<T, AppError>` 반환 → wrapper/runtime post-processing → store/UI 반영

IPC error contract: `AppError::Cancel` and `AppError::DbMismatch` serialize as
typed envelopes. `DbMismatch` includes stable legacy `message` text plus
`payload.expected` / `payload.actual`; other `AppError` variants keep legacy
string serialization until their own contract migration. Frontend error
branches use `src/lib/tauri/error.ts` normalizer; legacy string parsing remains
boundary compatibility only.

`src/lib/runtime/**` 는 pure `lib` 예외 구역이다. boot/event/history/recovery 처럼
React 밖에서 여러 store action 과 Tauri boundary 를 묶는 orchestration 만 둔다.

## 관련 방

- [data-source](data-source/memory.md) — source profile, capability, adapter, result envelope architecture
- [query-language](query-language/memory.md) — parser/completion/Safe Mode ownership
- [state-management](state-management/memory.md) — persistence, workspace identity, cross-window sync
- [paradigms](paradigms/memory.md) — RDB / Document / Search / KV UI heuristic; support state SOT 아님
- [docs/ROADMAP.md](../../../docs/ROADMAP.md) — 미래 목표와 승격 후보
- [conventions](../conventions/memory.md) — Rust/TS 코딩 규칙, 테스트, 커밋
- [docs/decisions](../../../docs/decisions/memory.md) — ADR 인덱스. Accepted 가 live policy, Superseded 는 「역사」 절
