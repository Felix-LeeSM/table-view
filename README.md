# Table View

**Table View**는 Tauri 2, React 19, TypeScript, Rust로 만드는 로컬 데스크톱 데이터베이스 클라이언트입니다.

TablePlus처럼 빠르게 연결하고, 스키마와 컬렉션을 탐색하고, 데이터를 바로 확인·편집하는 흐름을 지향합니다. PostgreSQL과 MongoDB를 가장 깊은 1차 표면으로 다루며, MySQL과 MariaDB는 runtime smoke baseline까지 검증되어 있습니다. SQLite, DuckDB도 검증된 범위 안에서 연결, 탐색, 쿼리 경로가 열려 있습니다. Redis는 연결/profile, key browser, value preview가 있고 write/TTL/stream UI는 후속입니다.

다중 창 워크스페이스, 변경 사항의 Preview/Commit 게이트, 운영 환경의 destructive 작업을 막는 Safe Mode를 통해 로컬 클라이언트의 속도와 데이터 작업의 안전장치를 함께 제공합니다.

---

## 🌟 주요 기능 (Key Features)

### 1. 다중 DBMS와 RDB/Document 패러다임 지원

- **PostgreSQL**: 스키마, 테이블, 뷰, 인덱스, 제약 조건(PK/FK/CHECK/UNIQUE), 함수/트리거 소스 조회, 테이블/컬럼/인덱스/제약 DDL UI를 지원합니다.
- **MySQL/MariaDB**: 데이터베이스 전환, 테이블/컬럼/인덱스/제약/뷰/함수/트리거 조회, SQL 실행, 테이블 페이징/필터/정렬, 주요 DDL UI 백엔드가 연결되어 있습니다. MySQL과 MariaDB는 connect/browse/query/edit/cancel runtime smoke baseline이 있고, MySQL-family 고유 문법의 클라이언트 분석은 아직 부분 지원입니다.
- **SQLite**: 파일 기반 연결과 DB 파일 생성, 테이블/컬럼 탐색, 테이블 미리보기, 단일 쿼리 실행, 배치 실행과 dry-run을 지원합니다. DDL UI와 export parity는 아직 명시적으로 제한됩니다.
- **DuckDB**: 파일 기반 `.duckdb` 연결과 raw SQL 실행, 로컬 CSV/Parquet/JSON/NDJSON preview 경로를 지원합니다. 구조화된 DDL/write UI와 file analytics query UI parity는 아직 명시적으로 제한됩니다.
- **MongoDB**: 데이터베이스/컬렉션 탐색, 도큐먼트 그리드, find/aggregate/insert/update/delete/bulkWrite, 인덱스와 validator 관리, collection/server 진단 명령을 지원합니다. 임의 JavaScript를 실행하지 않고 허용된 `db....` 워크플로우만 파싱해 dispatch 합니다.
- **Redis**: 연결/profile, backend KV primitive, key browser, value preview가 있습니다. value edit, TTL 변경, guarded string write, bounded stream UI는 후속입니다.
- **Elasticsearch/OpenSearch**: 현재 fixture-backed Search adapter/result slice만 있습니다. Live HTTP 연결 UI와 catalog/query execution은 후속입니다.
- **MSSQL**: SQL authentication 연결/버전 probe, bounded SELECT/DML query runtime, bounded static parser/Safe Mode metadata가 있습니다. catalog/edit, runtime Safe Mode smoke, fixture smoke, desktop E2E parity, full T-SQL semantic parity는 후속입니다.
- **Oracle**: connection UI와 서비스명 기반 runtime test/connect path가 있습니다. SID, TNS alias, wallet/TLS, catalog/query/edit/DDL은 후속입니다. 기본 dev/e2e fixture connection으로 추가되지 않습니다.

세부 쿼리/자동완성 범위는 [`docs/product/query-language-support.md`](./docs/product/query-language-support.md)에 정리되어 있습니다.

### 2. 다중 창 워크스페이스 & 동기화

- **Launcher & Workspace**: 연결 목록과 접속 설정은 런처 창에서 관리하고, 실제 DB 작업은 연결별 워크스페이스 창에서 수행합니다.
- **상태 동기화**: 연결/그룹, 테마, 주요 워크스페이스 상태, MRU/히스토리성 데이터가 로컬 저장소와 Tauri 이벤트를 통해 창 사이에서 일관되게 갱신됩니다.

### 3. 인라인 데이터 편집 & 변경 검토 게이트

- RDB 그리드에서 행 추가/수정/삭제를 인라인으로 처리하고, 실행 전 SQL preview를 확인한 뒤 Commit 또는 Discard할 수 있습니다.
- MongoDB 도큐먼트 편집도 MQL preview를 거쳐 적용되며, bulkWrite 기반 변경 흐름을 지원합니다.

### 4. 스키마/구조 편집 UI

- PostgreSQL/MySQL 계열에서 테이블/컬럼 생성, 이름 변경, 삭제, 인덱스 생성/삭제, FK/CHECK/UNIQUE 제약 추가/삭제를 UI에서 다룹니다.
- 실행 전 DDL statement preview와 Safe Mode 게이트를 거쳐 destructive 변경을 한 번 더 확인합니다.

### 5. Safe Mode

> [!IMPORTANT]
> 운영(Production) 환경으로 표시된 연결에서는 `WHERE` 없는 `UPDATE`/`DELETE`, `DROP`, `TRUNCATE`, destructive Mongo command 같은 작업이 바로 실행되지 않습니다. 사용자는 preview와 type-to-confirm 대화상자를 거쳐 명시적으로 승인해야 합니다.

### 6. 쿼리 에디터

- CodeMirror 6 기반 SQL/MQL 에디터를 사용합니다.
- PostgreSQL, MySQL, SQLite는 DBMS별 SQL dialect highlighting과 테이블/컬럼 자동완성을 제공합니다.
- MongoDB는 컬렉션, 메서드, query operator, aggregation stage, accumulator, BSON literal 후보를 제공합니다.
- PostgreSQL 테이블 설계 UI는 서버의 사용자 정의 타입 목록을 가져와 컬럼 타입 후보에 반영합니다.

### 7. 데이터 내보내기

- 조회한 그리드 데이터를 CSV, TSV, SQL INSERT, JSON으로 내보낼 수 있습니다.
- MongoDB row export는 Extended JSON v2 Relaxed 형태를 보존합니다.

---

## 🔒 보안 및 저장 (Security)

- **비밀번호 보호**: connection 비밀번호 평문은 렌더러로 다시 노출하지 않습니다. 저장 시 AES-256-GCM으로 암호화하고, 파일 키는 가능하면 OS keyring(macOS Keychain, Windows Credential Manager, Linux Secret Service)에 둡니다.
- **Linux fallback**: Secret Service가 없는 최소 Linux 환경에서는 권한이 제한된 로컬 key 파일 fallback을 사용하고 사용자에게 디스크 암호화를 권장합니다.
- **로컬 권한 제어**: 앱 데이터는 로컬 사용자 데이터 디렉터리에 저장되며, Unix 계열에서는 민감 파일 권한을 `0600`으로 제한합니다.

---

## 🛠️ 개발 환경 셋업 (Development & Setup)

이 프로젝트를 로컬에서 빌드하고 기여하려는 개발자를 위한 안내입니다.

### 1. 준비물

- [mise](https://mise.jdx.dev/) 또는 asdf — `.tool-versions` 기반 런타임 관리
- OS별 Tauri 2 시스템 의존성

버전 기준은 [`.tool-versions`](./.tool-versions)입니다. Node.js, pnpm, Rust, lefthook, direnv 버전이 이 파일에 고정되어 있습니다.

### 2. 초기 셋업

신규 클론 후 런타임, cargo 보조 도구, git hook, npm 의존성을 한 번에 준비합니다.

```bash
bash scripts/setup.sh
```

이미 도구가 준비된 상태에서 JavaScript 의존성만 다시 받으려면:

```bash
pnpm install
```

### 3. 개발용 데이터베이스 실행

PostgreSQL, MongoDB, MySQL, MariaDB, MSSQL, Oracle, Redis compose 컨테이너를
띄우고 health check를 기다립니다.

```bash
pnpm db:up
```

MSSQL 컨테이너는 수동 연결과 bounded query runtime/live test에 사용할 수 있지만
기본 fixture connection이나 desktop E2E smoke로 승격되어 있지는 않습니다.
Oracle은 서비스명 기반 connection test/connect path만 앱에 연결되어 있으며,
SID/TNS alias/wallet/TLS와 catalog/query/edit/DDL은 후속입니다. 두 DBMS 모두
기본 fixture connection이나 desktop smoke evidence로 승격하지 않습니다.

기본 접속 정보:

| DBMS       | Host        | Port    | User       | Password       | Database / service |
| ---------- | ----------- | ------- | ---------- | -------------- | ------------------ |
| PostgreSQL | `localhost` | `15432` | `testuser` | `testpass`     | `table_view_test`  |
| MySQL      | `localhost` | `13306` | `testuser` | `testpass`     | `table_view_test`  |
| MongoDB    | `localhost` | `37017` | `testuser` | `testpass`     | `table_view_test`  |
| MariaDB    | `localhost` | `23306` | `testuser` | `testpass`     | `table_view_test`  |
| MSSQL      | `localhost` | `14333` | `sa`       | `Testpass123!` | `master`           |
| Oracle     | `localhost` | `1521`  | `testuser` | `testpass`     | `XEPDB1`           |
| Redis      | `localhost` | `6379`  |            |                | `0`                |

PostgreSQL connection URL:

```text
postgresql://testuser:testpass@localhost:15432/table_view_test
```

MongoDB는 auth source로 `admin`을 사용합니다.

컨테이너와 compose volume을 함께 정리하려면:

```bash
pnpm db:down
```

### 4. 개발 서버 실행

Vite 프론트엔드와 Tauri 백엔드를 함께 로컬 디버그 모드로 실행합니다.

```bash
pnpm tauri dev
```

앱이 부팅되면 런처 창에서 연결을 만들고 더블클릭으로 워크스페이스에 진입합니다.

### 5. 자주 쓰는 개발 명령어

```bash
pnpm dev                # Vite dev 서버 (Tauri 데스크톱 없이 브라우저 전용)
pnpm build              # TypeScript 타입 체크 + Vite production build
pnpm lint               # ESLint
pnpm format             # Prettier (src/)
pnpm format:docs        # Prettier (README, CLAUDE, docs, .claude markdown)
pnpm tauri dev          # Tauri 데스크톱 dev
pnpm tauri build        # Tauri 데스크톱 production build
pnpm wasm:size          # SQL/Mongo parser WASM gzip budget check
```

Parser WASM 산출물은 `src/lib/**/wasm/` 아래에 체크인되어 있어 로컬 `wasm-pack` 없이도 앱을 빌드할 수 있습니다. 해당 산출물이나 Rust parser crate를 바꾸면 `pnpm wasm:size`가 계속 통과해야 합니다. SQL parser WASM은 gzip 200 KiB, Mongo parser WASM은 gzip 53 KiB가 상한입니다.

---

## 🧪 테스트 실행 (Testing)

### 1. 프론트엔드 단위 테스트

```bash
pnpm test
pnpm test -- --coverage
```

### 2. Rust 백엔드 단위 테스트

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### 3. 통합 테스트 (Docker 필요)

`pnpm db:up`으로 DB 컨테이너를 띄운 뒤 실행합니다.

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration
```

### 4. E2E Smoke 테스트 (Linux host / CI)

WebdriverIO + tauri-driver로 실제 Tauri 앱을 부팅해 PostgreSQL, MySQL,
MariaDB, MongoDB runtime happy path를 검증합니다. GitHub Actions에서는 PR과
`main` push의 blocking check로 실행됩니다.

로컬 Linux 환경에서 동일 경로를 실행하려면:

```bash
pnpm db:up
E2E_PG_PORT=15432 E2E_MYSQL_PORT=13306 E2E_MARIADB_PORT=23306 E2E_MONGO_PORT=37017 bash scripts/e2e-smoke-ci.sh
```

macOS/Windows 로컬에서는 tauri-driver의 Linux/GTK 의존성 차이 때문에 CI 검증을 기준으로 봅니다.

---

## 📦 빌드 상태 (Build)

배포 필수 플랫폼은 macOS arm64와 Windows x86_64입니다.

```bash
pnpm build
pnpm tauri build --debug
```

macOS debug 앱 번들은 `src-tauri/target/debug/bundle/macos/Table View.app`에 생성됩니다. 배포용 패키징 상태와 남은 계획은 [`docs/PLAN.md`](./docs/PLAN.md), [`docs/ROADMAP.md`](./docs/ROADMAP.md), [`docs/product/known-limitations.md`](./docs/product/known-limitations.md)를 기준으로 확인합니다.

## 🍺 Homebrew 배포 (Homebrew)

`release` 이벤트가 `published`로 바뀌면 이 저장소의 워크플로가 Homebrew tap을 갱신합니다.
현재 절차는 `publish` 수동 승인 후 반영됩니다.

```bash
brew tap Felix-LeeSM/table-view
brew install --cask table-view
```

설치 방법은 [`docs/contributor-guide/release/homebrew-cask.md`](./docs/contributor-guide/release/homebrew-cask.md)를 확인하세요.
