# Architecture — Table View

Tauri 2.0 + React + Rust 기반 데스크톱 데이터베이스 관리 도구.

## 시스템 구조

```
┌─────────────────────────────────────────┐
│            Tauri 2.0 App                │
├─────────────────────────────────────────┤
│   WebView (React + TypeScript)          │
│   ┌──────────┬──────────────────┐       │
│   │ Left     │  Center          │       │
│   │ Panel    │  ┌────────────┐  │       │
│   │ ──────── │  │  Tab Bar   │  │       │
│   │ Conns    │  ├────────────┤  │       │
│   │ Schema   │  │  Editor /  │  │       │
│   │ Tree     │  │  Grid      │  │       │
│   │          │  └────────────┘  │       │
│   │          ├──────────────────┤       │
│   │          │  Bottom Panel    │       │
│   │          │  (Query Log &    │       │
│   │          │   Results)       │       │
│   └──────────┴──────────────────┘       │
├─────────────────────────────────────────┤
│   Rust Backend (Tauri Commands)         │
│   ┌────────────────────────────┐        │
│   │ DB Driver Layer            │        │
│   │  ├─ PostgresAdapter        │        │
│   │  └─ trait DbAdapter (ext.) │        │
│   ├────────────────────────────┤        │
│   │ Connection Manager         │        │
│   │  └─ Local JSON storage     │        │
│   ├────────────────────────────┤        │
│   │ Query Executor             │        │
│   │  └─ Async, cancellable     │        │
│   ├────────────────────────────┤        │
│   │ Schema Introspector        │        │
│   │  └─ information_schema     │        │
│   └────────────────────────────┘        │
├─────────────────────────────────────────┤
│   Local File System                     │
│   ~/.table-view/                        │
│   ├─ connections.json                   │
│   ├─ preferences.json                   │
│   ├─ query-history.json                 │
│   └─ favorites/                         │
└─────────────────────────────────────────┘
```

## DB Driver 추상화

```rust
pub trait DbAdapter: Send + Sync {
    async fn connect(&self, config: &ConnectionConfig) -> Result<()>;
    async fn disconnect(&self) -> Result<()>;
    async fn execute(&self, query: &str) -> Result<ExecuteResult>;
    async fn query(&self, query: &str) -> Result<Vec<Row>>;
    async fn get_tables(&self) -> Result<Vec<TableInfo>>;
    async fn get_schema(&self, table: &str) -> Result<TableSchema>;
}
```

각 DBMS(PostgreSQL, MySQL, SQLite 등)는 이 trait을 구현. Connection Factory 패턴으로 드라이버 인스턴스 생성. 모든 DB 작업은 async.

## 기술 결정

### Rust Crate 선택

| 목적 | Crate | 이유 |
|------|-------|------|
| DB 드라이버 | `sqlx` (async) | 컴파일 타임 쿼리 체크, 다중 DB 지원, async |
| 직렬화 | `serde` + `serde_json` | JSON 설정 파일, Tauri command 통신 |
| 암호화 | `aes-gcm` | 연결 비밀번호 암호화 |
| 에러 처리 | `thiserror` + `anyhow` | 타입 안전 에러 |
| 로깅 | `tracing` | 구조화된 로그 |

### Frontend 라이브러리

| 목적 | 라이브러리 | 이유 |
|------|-----------|------|
| UI 프레임워크 | React + TypeScript | 생태계, Tauri 호환 |
| 상태 관리 | Zustand | 가볍고 단순 |
| SQL 에디터 | CodeMirror 6 | 확장성, 자동완성 플러그인 |
| 데이터 그리드 | 커스텀 (DataGrid) | 가상 스크롤, 편집 지원 |
| 스타일링 | Tailwind CSS 4 | 빠른 프로토타이핑 |
| 아이콘 | Lucide React | 가볍고 일관된 디자인 |

## 설계 결정 사항

### 장시간 실행 쿼리 전략 — 옵션 D 채택

- 기본 쿼리 타임아웃: 60초 (사용자 설정 가능, 0 = 무제한)
- 진행 표시기: 경과 시간 실시간 표시 + 취소 버튼
- 실행 전 경고: WHERE 절 없는 UPDATE/DELETE, CROSS JOIN 감지 시 확인 다이얼로그
- 백그라운드 실행: Phase 5 이후 고려
