# Table View

**Table View**는 모던하고 경량화된 고성능 로컬 데스크톱 데이터베이스 클라이언트입니다.

Tauri 2.0, React 19, Rust 기반으로 구축되어 가벼우면서도 매우 빠른 성능을 자랑하며, PostgreSQL과 MongoDB라는 두 가지 서로 다른 데이터 패러다임을 하나의 미려한 사용자 인터페이스 안에서 일관되게 제어할 수 있도록 설계되었습니다.

단순한 데이터 조회를 넘어 다중 창(Multi-window) 워크스페이스 격리, 변경 사항의 일괄 검토/커밋 게이트, 그리고 운영 환경의 실수를 철저히 방어하는 Safe Mode까지 지원하여 전문 개발자와 데이터 관리자에게 안전하고 매끄러운 데이터 워크플로우를 제공합니다.

---

## 🌟 주요 기능 (Key Features)

### 1. RDB & NoSQL 듀얼 패러다임 지원 (PostgreSQL & MongoDB)

- **PostgreSQL**: 스키마, 테이블, 뷰, 인덱스, 제약 조건(PK/FK/Check/Unique), 함수 소스 조회를 지원하며, 직관적인 DDL 편집 인터페이스를 제공합니다.
- **MongoDB**: 컬렉션 탐색, 도큐먼트 그리드 뷰, 애그리게이션 파이프라인(Aggregate) 및 벌크 쓰기(Bulk-write)를 완벽히 지원하며, 스키마 구조를 자동으로 분석(Field Inference)합니다.

### 2. 다중 창 워크스페이스 & 실시간 동기화 (Multi-Window Workspace)

- **Launcher & Workspace**: 데이터베이스 목록 및 접속 설정을 전담하는 '런처(Launcher)' 창과, 연결된 DB별 개별 작업을 수행하는 '워크스페이스(Workspace)' 창이 완벽하게 분리되어 깔끔한 화면 구성을 제공합니다.
- **실시간 IPC 동기화**: 여러 워크스페이스 창을 동시에 띄워도 즐겨찾기, 쿼리 히스토리, 스토어 상태가 실시간으로 안전하게 동기화됩니다.

### 3. 인라인 데이터 편집 & 변경 검토 게이트 (Inline Edit & Commit Gate)

- 데이터 그리드 내에서 행 추가/수정/삭제를 더블클릭으로 신속히 처리할 수 있습니다.
- 변경 사항은 즉시 반영되지 않고 **SQL/MQL 미리보기(Preview)** 단계를 거치며, 사용자가 직접 검토한 후 일괄 적용(Commit)하거나 취소(Discard)할 수 있어 안전합니다.

### 4. 강력한 스키마 DDL 구조 설계기 (DDL/Structure UI)

- 테이블/컬럼 생성(CREATE), 명칭 변경(RENAME), 삭제(DROP)를 마우스 클릭과 간단한 폼 입력만으로 진행할 수 있습니다.
- 복잡한 인덱스(B-tree, Hash 등) 설정 및 외래 키(FK), CHECK, UNIQUE 제약조건 추가를 visual UI 탭을 통해 수행하며, 실행 전 전체 DDL statement 미리보기를 지원합니다.

### 5. 실수 방지 프로덕션 가드 (Safe Mode)

- > [!IMPORTANT]
  > 운영(Production) 환경으로 설정된 연결에서는 위험한 쿼리(WHERE 조건이 생략된 UPDATE/DELETE, DDL 변경 등) 실행 시 강제로 차단되거나 경고 창이 표시됩니다. 사용자가 명시적으로 동의(지정 문구 타이핑)한 경우에만 실행이 허용되어 데이터 유실을 방지합니다.

### 6. 똑똑한 쿼리 에디터 (Smart SQL Editor)

- CodeMirror 6 기반의 에디터에서 테이블/컬럼명 자동완성(Auto-complete), SQL 포맷팅 및 미니파이 기능을 지원합니다.
- PostgreSQL의 경우 서버에 등록된 사용자 정의 데이터 타입 목록을 동적으로 가져와 테이블 설계 시 드롭다운으로 자동 매핑합니다.

### 7. 유연한 데이터 내보내기 (Export)

- 조회한 그리드 데이터를 CSV, TSV, SQL INSERT 문, JSON 형식으로 빠르게 파일로 내보낼 수 있습니다.

---

## 🔒 보안 및 저장 (Security)

- **안전한 비밀번호 저장**: OS 네이티브 자격증명 관리 시스템(macOS Keychain, Windows Credential Manager, Linux Secret Service) 및 로컬 AES-256-GCM 암호화 방식을 연동하여 패스워드를 안전하게 보관합니다.
- **로컬 권한 제어**: 연결 세션 및 히스토리는 로컬 앱 데이터 디렉터리 내에 저장되며, Unix 계열 OS에서는 파일 접근 권한을 `0600`으로 자동 제한하여 다른 프로세스의 유출을 방지합니다.

---

## 🛠️ 개발 환경 셋업 (Development & Setup)

이 프로젝트를 로컬에서 빌드하고 직접 기여하려는 개발자를 위한 안내입니다.

### 1. 준비물

- [mise](https://mise.jdx.dev/) (또는 asdf) — `.tool-versions` 기반 런타임 버전 관리
- OS별 Tauri 2 시스템 의존성 (macOS는 Xcode Command Line Tools 등 필요)

버전 규격은 [`.tool-versions`](./.tool-versions) 파일에 기술되어 있습니다 (Node.js, pnpm, Rust, lefthook, direnv).

### 2. 초기 셋업

프로젝트를 처음 클론한 후 다음 명령어를 실행하여 런타임, cargo 보조 도구, git hook을 활성화합니다.

```bash
bash scripts/setup.sh
```

이미 도구들이 셋업되어 있는 상태에서 npm 의존성만 다시 받으려면:

```bash
pnpm install
```

### 3. 개발용 데이터베이스 실행 (Docker)

로컬 개발 및 통합 테스트 검증을 위해 PostgreSQL, MongoDB, MySQL 컨테이너를 가동합니다.

```bash
docker compose up -d
```

> **개발 PostgreSQL 접속 정보:**
>
> - Host: `localhost` | Port: `5432` | User: `postgres` | Password: `postgres`
> - Database: `table_view_test`
> - Connection URL: `postgresql://postgres:postgres@localhost:5432/table_view_test`

### 4. 개발 서버 실행

Vite 프론트엔드와 Tauri 백엔드를 동시에 로컬 디버그 모드로 구동합니다.

```bash
pnpm tauri dev
```

앱이 부팅되면 **런처(Launcher)** 창에서 새 연결을 생성하여 진입할 수 있습니다.

### 5. 자주 쓰는 개발 명령어

```bash
pnpm dev                # Vite dev 서버 구동 (Tauri 데스크톱 없이 브라우저 전용 실행)
pnpm build              # TypeScript 타입 체크 및 Vite 프로덕션 빌드
pnpm lint               # ESLint 코드 스타일 분석
pnpm format             # Prettier 포맷 적용 (src/)
pnpm format:docs        # 마크다운 문서 포맷 적용 (README 및 docs/)
pnpm wasm:size          # SQL/Mongo WebAssembly 파서 크기 제한(gzip budget) 검증
```

---

## 🧪 테스트 실행 (Testing)

### 1. 프론트엔드 유닛 테스트

Vitest를 기반으로 2900개 이상의 테스트 케이스를 가집니다.

```bash
pnpm test               # 테스트 1회 구동
pnpm test -- --coverage # 테스트 커버리지 리포트 생성
```

### 2. Rust 백엔드 단위 테스트

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

### 3. 통합 테스트 (Docker 필요)

로컬에서 Docker DB 컨테이너가 켜진 상태에서 실제 스키마 쿼리 통합 테스트를 실행합니다.

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration
```

### 4. E2E Smoke 테스트 (Linux CI 검증용)

WebdriverIO + tauri-driver 기반으로 실제 Tauri 앱을 부팅하여 DBMS 연결부터 수정 커밋까지의 런타임 happy path를 검증합니다.

```bash
# 로컬 Linux 환경에서의 실행 예시
docker compose up -d postgres mongo
E2E_PG_PORT=15432 E2E_MONGO_PORT=37017 bash scripts/e2e-smoke-ci.sh
```

_(주의: macOS/Windows 환경에서는 tauri-driver의 GTK 의존성 제약으로 인해 로컬 실행이 제한되며, GitHub Actions CI blocking check를 통해 원격 검증됩니다.)_

### 5. 테스트 현황

| 영역      | 도구                       | 개수    | 비고                           |
| :-------- | :------------------------- | :------ | :----------------------------- |
| Frontend  | Vitest + RTL               | ~2900   | 226 files                      |
| Rust 단위 | cargo test --lib           | ~410    | lib tests                      |
| Rust 통합 | cargo test + Docker        | ~27     | schema + query                 |
| E2E smoke | WebdriverIO + tauri-driver | 2 specs | Linux host blocking PR/main CI |
