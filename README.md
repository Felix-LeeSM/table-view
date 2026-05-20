# Table View

Table View는 Tauri 2, React, TypeScript, Rust로 만드는 로컬 데스크톱 데이터베이스 브라우저입니다.

지향점은 TablePlus처럼 빠르게 연결하고, 스키마와 테이블을 탐색하고, 데이터를 바로 확인·편집할 수 있는 가벼운 로컬 클라이언트입니다. PostgreSQL과 MongoDB 두 패러다임을 1차 타겟으로 구현 중이며, TablePlus와는 별개의 독립 프로젝트입니다.

## 현재 상태

Phase 1–12 완료, Phase 13–27 진행 중. **TablePlus 패리티 7단계 (Phase 21–27) 마무리 단계** — Sprint 236 (2026-05-07 기준)까지 진행. Phase 17–20 (MySQL / MariaDB / SQLite / Oracle 어댑터)은 패리티 달성 시까지 보류.

구현된 범위:

- **연결 관리** — 생성, 수정, 삭제, 테스트, group + drag-and-drop, status 표시, keep-alive, 자동 재연결
- **PostgreSQL URL import**
- **다중 창 (Phase 12)** — launcher / workspace 분리, cross-window state sync (5 store IPC bridge)
- **MongoDB 지원** — collection 탐색, document grid, aggregate pipeline, bulk-write
- **스키마/테이블/컬럼/인덱스/제약 탐색** + Trigger / View / Sequence / Function read
- **탭 기반 데이터 조회** — 단일 preview slot 모델, 더블클릭 정규탭 승격
- **데이터 그리드** — 페이지네이션 / 단일·다중 컬럼 정렬 / 필터 / 기본 PK ASC sort
- **Row 인라인 편집 + Preview/Commit/Discard 게이트 (Phase 22)** — RDB UPDATE/INSERT/DELETE batched preview
- **CSV / TSV / SQL INSERT / JSON Export (Phase 21)** — RFC 4180, UTF-8 BOM, Mongo Extended JSON v2 Relaxed
- **Safe Mode (Phase 23)** — production 환경 자동 활성화 + dangerous query 차단/확인 gate
- **DDL UI (Phase 24–27)** — CREATE TABLE / RENAME TABLE / DROP TABLE / ADD COLUMN / DROP COLUMN / CREATE INDEX / ADD CONSTRAINT (FK · CHECK · UNIQUE) + inline DDL preview
- **SQL 에디터 (CodeMirror)** — 쿼리 실행, 동적 PG type list 자동완성, schema-qualified column autocomplete, syntax highlighting
- **Quick Look 편집** — row 단일 행 상세 + 인라인 편집
- **Query history** — source 필드 (raw / grid-edit / ddl-structure / mongo-\*) 통합 audit
- **비밀번호 로컬 암호화 저장** (AES-256-GCM)
- **다크/라이트/시스템 테마** — cross-window 즉시 sync
- **Docker 기반 통합 테스트 인프라** (PostgreSQL + MySQL) + Linux host E2E smoke

아직 없는 범위:

- PostgreSQL / MongoDB 외 백엔드 (MySQL, SQLite, Oracle, Redis 등)
- Column type modify (ALTER COLUMN TYPE + USING cast) — Phase 27 sprint 12 (Sprint 237) 대상
- Trigger / Function CREATE/EDIT UI — Phase 26 대상
- Row-level RLS, partition, materialized view UI

상세 계획은 [`docs/PLAN.md`](./docs/PLAN.md), 잔여 위험은 [`docs/RISKS.md`](./docs/RISKS.md)에 정리되어 있습니다.

## 실행

준비물:

- [mise](https://mise.jdx.dev/) (권장) 또는 asdf — `.tool-versions` 기반 런타임 관리
- OS별 Tauri 2 시스템 의존성

버전 기준은 [`.tool-versions`](./.tool-versions)입니다 (Node.js, pnpm, Rust, lefthook, direnv).

신규 클론 후 셋업 (런타임 + cargo 보조 도구 + git hook 활성화):

```bash
bash scripts/setup.sh
```

`scripts/setup.sh` 가 하는 일:

1. mise (또는 asdf) 로 `.tool-versions` 의 모든 런타임 설치
2. `cargo-binstall` 부트스트랩 후 `cargo-llvm-cov`, `cargo-deny`, `cargo-machete` 설치
3. `rustup component add llvm-tools-preview` (coverage 의존)
4. `git config core.hooksPath .githooks` (lefthook hook 활성화)
5. `pnpm install`

이미 셋업된 환경에서 의존성만 갱신하려면:

```bash
pnpm install
```

개발용 PostgreSQL 실행:

```bash
docker compose up -d
```

기본 접속 정보:

- Host: `localhost`
- Port: `5432`
- User: `postgres`
- Password: `postgres`
- Database: `table_view_test`

Connection URL:

```text
postgresql://postgres:postgres@localhost:5432/table_view_test
```

개발 실행:

```bash
pnpm tauri dev
```

개발 실행이 뜨면 launcher 창에서 연결을 만들고 더블클릭으로 workspace로 진입합니다. 좌측 사이드바에서 스키마/테이블을 탐색하고, 단일클릭으로 preview, 더블클릭으로 정규탭 승격할 수 있습니다.

## 빌드 상태

2026년 5월 7일 기준:

- `pnpm build`는 정상 동작 (production bundle ~1.2 MB)
- `pnpm tauri build --debug`는 macOS용 `.app` 번들 생성
- 확인 경로: `src-tauri/target/debug/bundle/macos/Table View.app`
- DMG 패키징 (`bundle_dmg.sh`) 흐름은 별도 정리 필요 — 배포 패키지 상태는 미정착

`pnpm tauri dev`로 실행하는 개발 흐름은 안정적이고, macOS debug `.app` 번들도 생성됩니다.

## 자주 쓰는 명령어

```bash
pnpm dev                # Vite dev (browser-only, Tauri 없이)
pnpm build              # tsc + vite build
pnpm test               # vitest run
pnpm lint               # eslint
pnpm format             # prettier (src/)
pnpm format:docs        # prettier (README + docs)
pnpm tauri dev          # Tauri 데스크톱 dev
pnpm tauri build        # Tauri 데스크톱 production 빌드
```

## 테스트

### 프론트엔드 단위 테스트

```bash
pnpm test                              # vitest run (~2900 tests)
pnpm test -- --coverage                # 커버리지 포함
```

### Rust 단위 테스트

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib   # ~410 tests
```

### 통합 테스트 (Docker 필요)

Docker daemon이 켜진 상태에서 실행:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration
```

기존 compose 스택을 재사용하려면 `pnpm db:up`으로 DB를 띄운 뒤
`PGHOST`/`PGPORT` 등 환경변수를 명시해서 실행합니다.

- `schema_integration`: 스키마, 컬럼, 인덱스, 필터, 정렬
- `query_integration`: SELECT, DML, DDL, 취소, 에러 처리
- Docker가 없어도 graceful skip으로 exit 0 반환

### E2E smoke (Linux host, blocking CI)

WebdriverIO + tauri-driver로 실제 Tauri 창을 띄워 최소 runtime happy path와 persisted write 경로를 검증합니다. 기존 full E2E suite와 Docker 안에서 앱까지 빌드하던 경로는 제거했고, smoke는 DBMS별 spec을 분리해서 실행합니다.

현재 smoke 범위:

- PostgreSQL: 연결 생성 → workspace 진입 → `users` 테이블 preview → cell edit → SQL preview 실행 → query tab에서 committed value 확인
- MongoDB: 연결 생성 → workspace 진입 → `table_view_test.smoke_users` collection preview → document edit → MQL preview 실행 → grid에서 committed value 확인

CI에서는 [`.github/workflows/e2e-smoke.yml`](./.github/workflows/e2e-smoke.yml)이 GitHub Actions service container로 PostgreSQL/MongoDB를 띄우고, Linux host에서 Tauri debug binary + xvfb + tauri-driver를 실행합니다. 이 workflow는 PR과 `main` push에서 blocking check로 동작하며, 실패하면 merge를 막습니다. `tsc`, `lint`, `vitest`, `build`가 비런타임 correctness gate이고, E2E smoke는 실제 앱 부팅과 DBMS별 runtime happy path를 보장합니다.

로컬 Linux 환경에서 동일한 경로를 실행하려면:

```bash
docker compose up -d postgres mongo
E2E_PG_PORT=15432 E2E_MONGO_PORT=37017 bash scripts/e2e-smoke-ci.sh
```

macOS/Windows에서는 tauri-driver 스택이 Linux WebKitGTK 기준이라 로컬 실행을 1차 지원하지 않습니다. 우선 Linux CI의 blocking smoke를 기준으로 유지하고, 로컬에서는 필요할 때 Linux VM/컨테이너 runner에서 확인합니다.

주요 환경변수:

- `TABLE_VIEW_TEST_DATA_DIR`: 테스트용 앱 데이터 디렉터리. spec별로 다른 하위 디렉터리를 써서 연결 fixture가 섞이지 않게 합니다.
- `E2E_PG_HOST`, `E2E_PG_PORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- `E2E_MONGO_HOST`, `E2E_MONGO_PORT`, `MONGO_USER`, `MONGO_PASSWORD`, `E2E_MONGO_DB`, `E2E_MONGO_AUTH_DB`

### 테스트 현황 (2026-05-07 기준)

| 영역      | 도구                       | 개수    | 비고                        |
| --------- | -------------------------- | ------- | --------------------------- |
| Frontend  | Vitest + RTL               | ~2900   | 226 files                   |
| Rust 단위 | cargo test --lib           | ~410    | lib tests                   |
| Rust 통합 | cargo test + Docker        | ~27     | schema + query              |
| E2E smoke | WebdriverIO + tauri-driver | 2 specs | Linux host blocking PR/main CI |

## 저장과 보안

연결 정보는 OS의 로컬 앱 데이터 디렉터리 아래 `table-view` 폴더에 저장됩니다.

- `connections.json`: 연결 및 그룹 정보
- `.key`: 비밀번호 암호화 키

비밀번호는 AES-256-GCM으로 암호화해서 저장하며, Unix 계열에서는 저장 파일 권한을 `0600`으로 제한합니다.

production 환경 connection은 Safe Mode가 자동 활성화되어 dangerous DDL/DML이 typing-confirm + Safe Mode confirm 2-layer를 거칩니다 (Phase 23, Sprint 189–190).
