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
- **Query history** — source 필드 (raw / grid-edit / ddl-structure / mongo-*) 통합 audit
- **비밀번호 로컬 암호화 저장** (AES-256-GCM)
- **다크/라이트/시스템 테마** — cross-window 즉시 sync
- **Docker 기반 통합 테스트 인프라** (PostgreSQL + MySQL)

아직 없는 범위:

- PostgreSQL / MongoDB 외 백엔드 (MySQL, SQLite, Oracle, Redis 등)
- Column type modify (ALTER COLUMN TYPE + USING cast) — Phase 27 sprint 12 (Sprint 237) 대상
- Trigger / Function CREATE/EDIT UI — Phase 26 대상
- Row-level RLS, partition, materialized view UI

상세 계획은 [`docs/PLAN.md`](./docs/PLAN.md), 잔여 위험은 [`docs/RISKS.md`](./docs/RISKS.md)에 정리되어 있습니다.

## 실행

준비물:

- Node.js `22.14.0`
- pnpm `10.20.0`
- Rust `1.91.0`
- OS별 Tauri 2 시스템 의존성

버전 기준은 [`.tool-versions`](./.tool-versions)입니다.

의존성 설치:

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

PostgreSQL 컨테이너를 띄운 후 실행:

```bash
docker compose -f docker-compose.test.yml up -d
./scripts/wait-for-test-db.sh
cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration
docker compose -f docker-compose.test.yml down
```

또는 한 명령으로:

```bash
pnpm test:docker
```

- `schema_integration`: 스키마, 컬럼, 인덱스, 필터, 정렬
- `query_integration`: SELECT, DML, DDL, 취소, 에러 처리
- Docker가 없어도 graceful skip으로 exit 0 반환

포트 충돌 시 환경변수로 오버라이드:

```bash
PG_PORT=15432 pnpm test:docker
```

### E2E 테스트 (host 전용, pre-push 게이트)

WebdriverIO + tauri-driver로 네이티브 Tauri 창을 테스트합니다.

```bash
pnpm test:e2e               # WebdriverIO (host docker daemon + psql 사전조건 필요)
```

ADR 0019 (2026-05-01)에 따라 e2e는 **CI에서 제거되어 lefthook pre-push가 유일한 게이트**입니다. 현재 e2e suite는 vite v6 build OOM 회복 작업으로 `lefthook.yml`의 `5_e2e: skip: true` 상태이며, 복구 sprint 진행 중. 자세한 내용은 [`memory/lessons/`](./memory/lessons/) 참고.

로컬 실행에는 추가 의존성이 필요합니다:

```bash
./scripts/setup-e2e.sh      # 안내 출력
```

### 테스트 현황 (2026-05-07 기준)

| 영역 | 도구 | 개수 | 비고 |
|------|------|------|------|
| Frontend | Vitest + RTL | ~2900 | 226 files |
| Rust 단위 | cargo test --lib | ~410 | lib tests |
| Rust 통합 | cargo test + Docker | ~27 | schema + query |
| E2E | WebdriverIO + tauri-driver | — | host pre-push 게이트, 현재 skip 상태 |

## 저장과 보안

연결 정보는 OS의 로컬 앱 데이터 디렉터리 아래 `table-view` 폴더에 저장됩니다.

- `connections.json`: 연결 및 그룹 정보
- `.key`: 비밀번호 암호화 키

비밀번호는 AES-256-GCM으로 암호화해서 저장하며, Unix 계열에서는 저장 파일 권한을 `0600`으로 제한합니다.

production 환경 connection은 Safe Mode가 자동 활성화되어 dangerous DDL/DML이 typing-confirm + Safe Mode confirm 2-layer를 거칩니다 (Phase 23, Sprint 189–190).
