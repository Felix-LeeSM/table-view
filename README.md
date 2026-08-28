# Table View

**Table View**는 Tauri 2, React 19, TypeScript, Rust로 만드는 로컬 데스크톱 데이터베이스 클라이언트입니다.

TablePlus처럼 빠르게 연결하고, 스키마와 컬렉션을 탐색하고, 데이터를 바로 확인·편집하는 흐름을 지향합니다. PostgreSQL이 가장 강한 RDBMS lane이고 MongoDB는 whitelisted document workflow가 활성입니다. MySQL, MariaDB, SQLite, DuckDB, Redis, Valkey, Elasticsearch, OpenSearch, MSSQL, Oracle에 대해서는 SOT에 기록된 bounded runtime slice와 smoke/focused evidence가 덮는 범위 안에서 지원합니다.

다중 창 워크스페이스, 변경 사항을 검토하는 Preview/Commit 게이트, 운영 환경에서 destructive 작업을 막는 Safe Mode를 갖추었습니다. 그래서 로컬 클라이언트의 속도와 데이터 작업의 안전장치를 함께 제공합니다.

---

## 🌟 주요 기능 (Key Features)

### 1. 다중 DBMS와 RDB/Document/KV/Search 패러다임 지원

- **PostgreSQL**: 스키마, 테이블, 뷰, 인덱스, 제약 조건(PK/FK/CHECK/UNIQUE), 함수/트리거 소스 조회, 테이블/컬럼/인덱스/제약 DDL UI를 지원합니다.
- **MySQL/MariaDB**: 데이터베이스 전환, 테이블/컬럼/인덱스/제약/뷰/함수/트리거 조회, SQL 실행, 테이블 페이징/필터/정렬, 주요 DDL UI 백엔드가 연결되어 있습니다. MySQL과 MariaDB는 connect/browse/query/edit/cancel runtime smoke baseline이 있고, MySQL-family 고유 문법의 클라이언트 분석은 아직 부분 지원입니다.
- **SQLite**: 파일 기반 연결과 DB 파일 생성, 테이블/컬럼 탐색, 테이블 미리보기, 단일 쿼리 실행, 배치 실행과 dry-run을 지원합니다. writable 파일에서는 SQLite 가 네이티브로 실행하는 구조화 DDL(테이블 생성/삭제/이름 변경, 컬럼 추가/삭제, 인덱스 생성/삭제)이 노출됩니다(#1804). 이미 있는 컬럼의 타입·NOT NULL·DEFAULT 변경과 독립 제약(FOREIGN KEY / CHECK / UNIQUE) 선언은 제공하지 않고, export parity 도 아직 명시적으로 제한됩니다.
- **DuckDB**: 파일 기반 `.duckdb` 연결과 raw SQL 실행, 로컬 CSV/Parquet/JSON/NDJSON 등록/preview, 등록된 source alias 대상 global editor SELECT smoke 경로를 지원합니다. writable connection 에서는 grid row edit 과 native 구조화 DDL(테이블 생성/삭제/이름 변경, 컬럼 추가/삭제/타입, 인덱스 생성/삭제)이 노출됩니다(ADR 0051 Stage 1/2, #1070). 제약 추가/삭제와 identity 컬럼(Stage 2b), dry-run/다중 statement 트랜잭션(Stage 3), COPY/ATTACH/DETACH, extension install/load, 자동 import/export, admin parity는 아직 명시적으로 제한됩니다.
- **MongoDB**: 데이터베이스/컬렉션 탐색, 도큐먼트 그리드, find/aggregate/insert/update/delete/bulkWrite, 인덱스와 validator 관리, collection/server 진단 명령을 지원합니다. 임의 JavaScript를 실행하지 않고 허용된 `db....` 워크플로우만 파싱해 dispatch 합니다.
- **Redis**: 연결/profile, key browser, value preview/edit UI, guarded string write, TTL 변경, exact-key delete confirmation, bounded command editor를 지원합니다. full CLI/admin parity, stream consumer UI, cluster/pubsub/modules, broader command coverage는 후속입니다.
- **Valkey**: 연결/profile, key scan/value preview, selected-key stream reader, bounded Redis-compatible command query, `GET`/`HGETALL`/`XRANGE`와 bounded `SET`/`EXPIRE` smoke 경로, direct UTF-8 string-key mutation controls가 있습니다. hash/list/set/zset writes와 full Redis compatibility는 후속입니다.
- **Elasticsearch/OpenSearch**: Live HTTP connection/catalog, bounded `_search` query, Search DSL validation/completion, delete-by-query safety planning과 Safe Mode confirm gate 뒤의 live `_delete_by_query` 실행, `_search` `profile` 실행 계획 뷰어를 지원합니다. actual live index/settings admin execution, observability, `_explain` workflow는 후속입니다.
- **MSSQL**: SQL authentication 연결/버전 probe, catalog browse, bounded SELECT/DML/DDL runtime, primary-key row edit, representative Safe Mode smoke, catalog-aware T-SQL editor assistance가 있습니다. TLS-required workflow, SQLCMD/admin/security/backup/jobs/users/roles, full T-SQL semantic parity는 후속입니다.
- **Oracle**: 서비스명 기반 lifecycle과 bounded catalog/query/cancel/tabular runtime slice를 지원합니다. catalog metadata, SELECT/DML batch, cooperative cancellation, table-data query가 범위이며 editRows, structured DDL, raw DDL/admin, parser/completion, PL/SQL body/package authoring/source, routine smoke, admin/import/export/full workbench는 후속입니다.

세부 쿼리/자동완성 범위는 [`docs/product/query-language-support.md`](./docs/product/query-language-support.md)에 정리되어 있습니다.

### 2. 다중 창 워크스페이스 & 동기화

- **Launcher & Workspace**: 연결 목록과 접속 설정은 런처 창에서 관리하고, 실제 DB 작업은 연결별 워크스페이스 창에서 수행합니다.
- **상태 동기화**: 연결/그룹, 테마, 주요 워크스페이스 상태, MRU/히스토리성 데이터가 로컬 저장소와 Tauri 이벤트로 창 사이에서 일관되게 갱신됩니다.

### 3. 인라인 데이터 편집 & 변경 검토 게이트

- RDB 그리드에서 행 추가/수정/삭제를 인라인으로 처리하고, 실행 전 SQL preview를 확인한 뒤 Commit 또는 Discard할 수 있습니다.
- MongoDB 도큐먼트 편집도 MQL preview를 거쳐 적용되며, bulkWrite 기반 변경 흐름을 지원합니다.

### 4. 스키마/구조 편집 UI

- PostgreSQL/MySQL 계열, MSSQL, Oracle에서 테이블/컬럼 생성, 이름 변경, 삭제, 인덱스 생성/삭제, FK/CHECK/UNIQUE 제약 추가/삭제를 UI에서 다룹니다. DuckDB는 테이블/컬럼/인덱스까지 다루고 제약 추가/삭제와 identity 컬럼은 아직 제외입니다(ADR 0051 Stage 2b). SQLite도 테이블/컬럼/인덱스까지 다루고, 제약 추가/삭제와 identity 컬럼, 이미 있는 컬럼 정의 변경은 제공하지 않습니다(#1804).
- 실행 전 DDL statement preview와 Safe Mode 게이트를 거쳐 destructive 변경을 한 번 더 확인합니다.

### 5. Safe Mode

> [!IMPORTANT]
> 운영(Production) 환경으로 표시된 연결에서는 `WHERE` 없는 `UPDATE`/`DELETE`, `DROP`, `TRUNCATE`, destructive Mongo command 같은 작업이 바로 실행되지 않습니다. 사용자는 preview와 Yes/No 확인 대화상자를 거쳐 명시적으로 승인해야 합니다.

### 6. 쿼리 에디터

- CodeMirror 6 기반 SQL/MQL 에디터를 사용합니다.
- PostgreSQL, MySQL/MariaDB, SQLite, DuckDB, MSSQL은 DBMS별 SQL dialect highlighting과 bounded 테이블/컬럼 자동완성을 제공합니다. Oracle은 runtime query dispatch만 활성이고 Oracle-specific parser/completion claim은 아직 없습니다.
- MongoDB는 컬렉션, 메서드, query operator, aggregation stage, accumulator, BSON literal 후보를 제공합니다.
- Redis/Valkey command editor와 Elasticsearch/OpenSearch Search DSL editor는 검증된 bounded vocabulary와 현재 catalog/key context 기반 후보를 제공합니다.
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

Contributor와 agent가 참고할 문서는 다음과 같습니다.

- Agent는 [`AGENTS.md`](./AGENTS.md)를 먼저 읽고, 작업 type별 workflow memory와
  surface rule을 이어서 읽습니다. Claude Code 전용 wrapper는
  [`CLAUDE.md`](./CLAUDE.md)입니다.
- Contributor-facing 절차와 검증 기대치는
  [`docs/contributor-guide/README.md`](./docs/contributor-guide/README.md)와
  [`docs/contributor-guide/testing-and-quality.md`](./docs/contributor-guide/testing-and-quality.md)를
  기준으로 확인합니다.
- 현재 제품 상태는 [`docs/product/README.md`](./docs/product/README.md), 지원
  경계는 [`docs/product/known-limitations.md`](./docs/product/known-limitations.md),
  미래 순서는 [`docs/ROADMAP.md`](./docs/ROADMAP.md)가 소유합니다.

### 1. 준비물

- [mise](https://mise.jdx.dev/) 또는 asdf: `.tool-versions`를 기준으로 런타임을 관리하는 도구
- OS별 Tauri 2 시스템 의존성

버전 기준은 [`.tool-versions`](./.tool-versions)입니다. Node.js, pnpm, Rust, direnv 버전이 이 파일에 고정되어 있습니다.

### 2. 초기 셋업

한 번에 준비해 주는 셋업 스크립트는 없습니다. 아래를 각각 준비하세요.

```bash
mise install          # asdf install로 대신할 수 있고, .tool-versions를 기준으로 삼습니다
pnpm install
```

Rust 보조 도구는 필요할 때 직접 설치합니다 (`cargo install cargo-nextest cargo-llvm-cov cargo-deny`). git hook 은 설치할 것이 없습니다.

JavaScript 의존성만 다시 받으려면 아래 명령을 실행합니다.

```bash
pnpm install
```

### 3. 개발용 데이터베이스 실행

PostgreSQL, MongoDB, MySQL, MariaDB, MSSQL, Oracle, Redis compose 컨테이너를
기동합니다. `docker compose up -d`는 health check 통과를 기다리지 않으므로,
연결하기 전에 `docker compose ps`로 `healthy` 상태를 확인하세요.

```bash
pnpm db:up
```

MSSQL과 Oracle 컨테이너는 수동 연결과 explicit fixture load에 사용됩니다.
Oracle은 #905 focused catalog/query/cancel/tabular evidence만 갖고, routine
Runtime Happy Path smoke wiring은 #907 전까지 넓히지 않습니다.

**Fixture seeding CLI(`pnpm db:seed`)는 없습니다.** 남아 있는 `pnpm fixtures:start`
/ `fixtures:stop`은 컨테이너를 기동하고 정지할 뿐 seed를 넣지 않습니다. 게다가
`fixtures:stop`은 `docker compose down -v`라서 볼륨까지 지웁니다. seed 데이터 자체는
`e2e/fixtures/`에 그대로 있으므로, 컨테이너에 직접 넣거나
`e2e/fixtures/seed-smoke.ts`로 smoke seeding을 실행할 수 있습니다. DBMS별 seed는
`e2e/fixtures/<dbms>/` 디렉터리에 들어 있지만, MSSQL과 Oracle의 seed는 디렉터리가
아니라 `e2e/fixtures/seed.mssql.sql`과 `e2e/fixtures/seed.oracle.sql` 파일입니다.

```bash
pnpm db:up            # 컨테이너 기동 (docker compose up -d)
docker compose exec -T mariadb mysql -utestuser -ptestpass table_view_test \
  < e2e/fixtures/mariadb/query/seed.sql
```

Oracle은 서비스명 기반 `XEPDB1` 경로가 기준입니다. #905 범위는 catalog metadata,
SELECT/DML batch, cooperative cancel, tabular table-data query까지입니다.
SID/TNS alias/wallet/TLS, raw admin, parser/completion, runtime smoke,
full PL/SQL semantics는 후속입니다.

기본 접속 정보는 다음과 같습니다.

| DBMS       | Host        | Port    | User       | Password       | Database / service |
| ---------- | ----------- | ------- | ---------- | -------------- | ------------------ |
| PostgreSQL | `localhost` | `15432` | `testuser` | `testpass`     | `table_view_test`  |
| MySQL      | `localhost` | `13306` | `testuser` | `testpass`     | `table_view_test`  |
| MongoDB    | `localhost` | `37017` | `testuser` | `testpass`     | `table_view_test`  |
| MariaDB    | `localhost` | `23306` | `testuser` | `testpass`     | `table_view_test`  |
| MSSQL      | `localhost` | `14333` | `sa`       | `Testpass123!` | `table_view_test`  |
| Oracle     | `localhost` | `1521`  | `testuser` | `testpass`     | `XEPDB1`           |
| Redis      | `localhost` | `6379`  |            |                | `0`                |

PostgreSQL connection URL은 다음과 같습니다.

```text
postgresql://testuser:testpass@localhost:15432/table_view_test
```

MongoDB는 auth source로 `admin`을 사용합니다.

컨테이너와 compose volume을 함께 정리하려면 아래 명령을 실행합니다.

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
pnpm lint               # Biome (일반 규칙) + ESLint (repo 고유 가드)
pnpm format             # Biome 포맷 적용
pnpm format:check       # Biome 포맷 검사 (쓰기 없음)
pnpm tauri dev          # Tauri 데스크톱 dev
pnpm tauri build        # Tauri 데스크톱 production build
```

Parser WASM 산출물은 `src/lib/**/wasm/` 아래에 체크인되어 있어 로컬 `wasm-pack` 없이도 앱을 빌드할 수 있습니다. gzip 상한(SQL parser 120 KiB, Mongo parser 62 KiB)은 CI의 `WASM Size Budget (non-blocking)` job이 wasm-pack으로 새로 빌드해서 잽니다. 이 job은 advisory라서 상한을 넘겨도 머지가 막히지 않으니, 산출물이나 Rust parser crate를 바꾸면 그 job을 직접 확인하세요. 로컬에서 체크인된 산출물을 재려면 아래 명령을 실행합니다.

```bash
bash scripts/check-wasm-size.sh
```

새로 빌드한 산출물을 재려면 앞에 `pnpm run build:sql-wasm && pnpm run build:mongosh-wasm`을 붙입니다. 이 두 명령은 체크인된 산출물과 그 디렉터리의 `.gitignore`를 덮어쓰므로 작업 트리에 커밋하지 않은 변경이 남습니다. 예산 근거와 재현 명령은 `scripts/check-wasm-size.sh` 머리말에 적혀 있습니다.

---

## 🧪 테스트 실행 (Testing)

### 1. 프론트엔드 단위 테스트

```bash
pnpm test
pnpm exec vitest run --coverage
```

> `pnpm test -- --coverage`는 쓰지 않습니다. pnpm 10은 `--`를 그대로 넘겨서
> `vitest run -- --coverage`가 되고, vitest는 `--` 뒤에 오는 인자를 플래그로 읽지
> 않습니다. 명령은 exit 0으로 끝나지만 커버리지는 수집되지 않습니다.

### 2. Rust 백엔드 단위 테스트

Rust crate는 모두 `src-tauri/`를 root로 하는 Cargo workspace에 속합니다 (#2161).
lib 테스트는 다음 한 줄로 끝납니다.

```bash
cd src-tauri && cargo test --workspace --lib
```

> `--workspace`가 member 전부를 포함하므로 crate가 늘어도 이 명령은 그대로입니다.
> 한 crate만 볼 때는 `cd src-tauri && cargo test -p table-view-core --lib`처럼
> `-p`로 고르세요.
> 통합 테스트까지 포함한 릴리스 전 순서는
> [`docs/contributor-guide/testing-and-quality.md`](./docs/contributor-guide/testing-and-quality.md)의
> Pre-Release Verification Gate Rust lane · Docker integration lane이 SOT입니다.

### 3. 통합 테스트 (Docker 필요)

`pnpm db:up`으로 DB 컨테이너를 기동한 뒤 실행합니다.

```bash
cd src-tauri && cargo test --test schema_integration --test query_integration
```

### 4. E2E Smoke 테스트 (Linux host)

WebdriverIO + tauri-driver로 실제 Tauri 앱을 부팅해 PostgreSQL, MySQL,
MariaDB, MSSQL, SQLite, DuckDB, MongoDB, Redis, Valkey,
Elasticsearch, OpenSearch runtime happy path를 검증합니다. Oracle은 #905 focused
runtime evidence만 갖고 routine smoke wiring은 #907 소유입니다.

**CI에서는 변경 영역만큼 실행됩니다.** `.github/workflows/e2e-smoke.yml`의
`Runtime Happy Path` job이 `e2e/scope-map.mjs`로 PR의 변경 경로를 spec 부분집합에
매핑해 그 부분집합만 실행합니다. e2e와 무관한 PR은 `selected 0 specs`를 출력하고
green으로 끝나며, main push와 야간 schedule, `workflow_dispatch`는 전체를
실행합니다. `e2e:full` label은 label 이벤트를 청취하지 않기 때문에, 붙인 뒤에 push
해야 전체가 실행됩니다. 아래처럼 직접 구동하는 경로도 그대로 남아 있습니다.

```bash
pnpm db:up
pnpm tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json
TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-smoke \
  E2E_SPEC_KEY=postgres pnpm exec tsx e2e/fixtures/seed-smoke.ts
TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-smoke \
  pnpm exec wdio run wdio.smoke.conf.ts --spec e2e/smoke/postgres.spec.ts
```

`pnpm db:up`은 PostgreSQL/MySQL/MariaDB/MongoDB/MSSQL/Oracle/Redis를 준비합니다.
헤드리스 Linux에서는 `WEBKIT_DISABLE_DMABUF_RENDERER=1`,
`WEBKIT_DISABLE_COMPOSITING_MODE=1`, `LIBGL_ALWAYS_SOFTWARE=1`을 직접 export해야
합니다 (#1261/#1293).

macOS와 Windows 로컬 환경에서는 이 절차를 host-native로 실행할 수 없습니다.
`tauri-driver`가 Linux 전용이라서 두 플랫폼의 host-native 검증이 실현 불가라고
[ADR 0020](./docs/decisions/0020-e2e-pre-push-host-docker/memory.md)이 판정했기
때문입니다. ADR 0020은 `Superseded` 상태입니다. 다만 ADR 0020을 대체한
[ADR 0044](./docs/decisions/0044-e2e-smoke-remote-required/memory.md)에는 이 platform
판정을 다시 적은 문장이 없습니다.

---

## 📦 빌드 상태 (Build)

배포 필수 플랫폼은 macOS arm64와 Windows x86_64입니다.
릴리스 태그 push, release workflow 수동 실행, draft release publish 전에는
[`docs/contributor-guide/testing-and-quality.md`](./docs/contributor-guide/testing-and-quality.md)의
Pre-Release Verification Gate를 같은 commit SHA 기준으로 통과시킵니다. 이 gate는
CI와 Runtime Happy Path를 필수 원격 증거로 보고, deferred check를 명시하며,
fixture-only evidence만으로 live support claim을 넓히는 것을 금지합니다.

```bash
pnpm build
pnpm tauri build --debug
```

macOS debug 앱 번들은 `src-tauri/target/debug/bundle/macos/Table View.app`에 생성됩니다. 배포용 패키징 상태와 남은 계획은 [`docs/PLAN.md`](./docs/PLAN.md), [`docs/ROADMAP.md`](./docs/ROADMAP.md), [`docs/product/known-limitations.md`](./docs/product/known-limitations.md)를 기준으로 확인합니다.
릴리스 노트의 지원 범위 요약과 fixture/smoke coverage는
[`docs/contributor-guide/release/release-notes-support-matrix.md`](./docs/contributor-guide/release/release-notes-support-matrix.md)를
기준으로 작성합니다.
버전/tag 결정, package artifact 기대값, post-release verification과 rollback note는
[`docs/contributor-guide/release/versioning-and-artifacts.md`](./docs/contributor-guide/release/versioning-and-artifacts.md)를
확인합니다.

## 🍺 Homebrew 배포 (Homebrew)

draft 릴리스를 손으로 publish하면 `.github/workflows/release.yml`의
`update-homebrew-tap` job이 `Felix-LeeSM/homebrew-table-view` tap의
`Casks/table-view.rb`를 갱신합니다.

```bash
brew tap Felix-LeeSM/table-view
brew install --cask table-view
```

설치 방법과 자동 갱신이 동작하지 않는 경우, 그때 밟아야 하는 수동 절차는
[`docs/contributor-guide/release/homebrew-cask.md`](./docs/contributor-guide/release/homebrew-cask.md)를 확인하세요.
