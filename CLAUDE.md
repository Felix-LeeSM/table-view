# View Table — Claude Code 프로젝트 가이드

## 프로젝트 개요

View Table은 Tauri 2.0 + React + Rust 기반의 TablePlus-like 데이터베이스 관리 도구입니다.
데스크톱 앱으로, 다중 DBMS(PostgreSQL, MySQL, SQLite, MongoDB 등)를 지원합니다.

## 기술 스택

| 영역 | 기술 |
|------|------|
| Desktop Framework | Tauri 2.0 |
| Frontend | React 19 + TypeScript 5 |
| State Management | Zustand |
| Styling | Tailwind CSS 4 |
| Backend | Rust (Tauri commands) |
| DB Drivers | rust-postgres, mysql_async, rusqlite, mongodb |
| Build Tool | Vite 6 (frontend), Cargo (backend) |
| Testing | Vitest (frontend), cargo test (backend), Playwright (e2e) |

## 디렉토리 구조

```
view-table/
├── src-tauri/           # Rust 백엔드
│   ├── src/
│   │   ├── main.rs      # Tauri 진입점
│   │   ├── db/          # DB driver 추상화 (trait DbAdapter)
│   │   ├── commands/    # Tauri IPC 명령 핸들러
│   │   ├── models/      # 데이터 모델 (struct)
│   │   └── error.rs     # 공통 에러 타입
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                 # React 프론트엔드
│   ├── components/      # UI 컴포넌트
│   ├── hooks/           # 커스텀 훅
│   ├── stores/          # Zustand 스토어
│   ├── pages/           # 페이지 단위 컴포넌트
│   ├── lib/             # 유틸리티, 헬퍼
│   └── types/           # TypeScript 타입 정의
├── e2e/                 # Playwright E2E 테스트
├── docs/                # 프로젝트 문서
└── CLAUDE.md            # 이 파일
```

## Rust 코딩 컨벤션

### 기본 규칙
- `cargo fmt`로 포맷팅, `cargo clippy`로 린트 통과 필수
- 에러 처리: `thiserror`로 커스텀 에러 타입 정의, `Result<T, AppError>` 사용
- `unwrap()` 사용 금지 (테스트 코드 제외). 대신 `?` 연산자나 `map_err` 사용
- 공개 API는 문서 주석(`///`) 필수

### Module 구조
- 각 모듈은 `mod.rs`에서 공개 인터페이스를 정의
- 파일 하나당 하나의 주요 struct/trait 정의
- 모듈 간 의존성은 최소화 (순환 참조 금지)

### DB Driver 추상화 (trait DbAdapter)
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
- 각 DBMS(PostgreSQL, MySQL, SQLite 등)는 이 trait을 구현
- Connection Factory 패턴으로 드라이버 인스턴스 생성
- 모든 DB 작업은 async로 구현

## TypeScript/React 컨벤션

### 컴포넌트
- 함수 컴포넌트만 사용 (class 컴포넌트 금지)
- 파일명: PascalCase (`ConnectionPanel.tsx`)
- 컴포넌트 1개 = 파일 1개
- Props 타입은 `interface`로 정의, `export` 필수

### 상태 관리
- 전역 상태: Zustand 스토어 (`stores/` 디렉토리)
- 지역 상태: `useState`, `useReducer`
- 서버 상태: 필요시 TanStack Query 고려
- 스토어 파일명: camelCase (`connectionStore.ts`)

### 스타일링
- Tailwind CSS 유틸리티 클래스 사용
- 커스텀 CSS 최소화
- 다크 모드 지원 필수

### TypeScript 규칙
- `any` 타입 사용 금지. 모르는 타입은 `unknown` 사용
- strict mode 필수
- 타입 가드로 `unknown` 좁히기

## 테스트 필수 규칙

### Rust 테스트
- 모든 새 기능/버그 수정에 단위 테스트 필수
- 테스트 위치: 같은 파일 하단 `#[cfg(test)] mod tests {}`
- 통합 테스트: `src-tauri/tests/` 디렉토리
- 커버리지: 핵심 로직(DbAdapter 구현체, 쿼리 파서) 80% 이상

### React 테스트
- 모든 컴포넌트에 렌더링 테스트 필수
- 테스트 도구: Vitest + React Testing Library
- 테스트 파일: 컴포넌트 옆에 `*.test.tsx` 또는 `__tests__/` 디렉토리
- Zustand 스토어는 순수 함수처럼 테스트

### E2E 테스트
- 주요 사용자 플로우에 대해 Playwright 테스트 작성
- 핵심 플로우: 연결 생성, 쿼리 실행, 결과 확인

## 금지 사항

- `unwrap()` 남용 (Rust 테스트 제외)
- `any` 타입 사용 (TypeScript)
- 민감 정보(비밀번호, API 키) 하드코딩
- `console.log` 디버깅 코드 커밋
- 직접적인 DOM 조작 (`document.querySelector` 등)
- 테스트 없는 새 기능 커밋
- `eval()`, `innerHTML` 사용 (XSS 위험)

## 커밋 메시지 규칙

Conventional Commits 형식:
```
type(scope): description

feat(connection): add connection test button
fix(query): handle empty result set
refactor(db): extract common adapter logic
test(connection): add unit tests for PostgreSQL adapter
```

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
