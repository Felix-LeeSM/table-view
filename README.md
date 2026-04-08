# View Table

View Table은 Tauri 2, React, TypeScript, Rust로 만드는 로컬 데스크톱 데이터베이스 브라우저입니다.

지향점은 TablePlus처럼 빠르게 연결하고, 스키마와 테이블을 탐색하고, 데이터를 바로 확인할 수 있는 가벼운 로컬 클라이언트입니다. 현재는 PostgreSQL 중심으로 구현 중이며, TablePlus와는 별개의 독립 프로젝트입니다.

## 현재 상태

초기 단계의 PostgreSQL-first 데스크톱 앱입니다.

구현된 범위:

- 연결 생성, 수정, 삭제, 테스트
- PostgreSQL URL import
- 연결 그룹과 드래그앤드롭 정리
- 연결 상태 표시, keep-alive, 자동 재연결 시도
- 스키마/테이블 탐색
- 탭 기반 테이블 데이터 조회
- 페이지네이션과 단일 컬럼 정렬이 있는 데이터 그리드
- 비밀번호 로컬 암호화 저장

아직 없는 범위:

- 실제 SQL 에디터/쿼리 실행 흐름
- 행 편집, 고급 필터, DDL 작업
- PostgreSQL 외 백엔드 지원

상세 계획은 [`docs/PLAN.md`](./docs/PLAN.md)에 정리되어 있습니다.

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
- Database: `viewtable_test`

Connection URL:

```text
postgresql://postgres:postgres@localhost:5432/viewtable_test
```

개발 실행:

```bash
pnpm tauri dev
```

## 빌드 상태

2026년 4월 8일 기준 확인 상태:

- `pnpm build`는 정상 동작합니다
- `pnpm tauri build --debug`는 macOS용 `.app` 번들까지 생성합니다
- 생성된 앱 경로: `src-tauri/target/debug/bundle/macos/View Table.app`
- 현재 DMG 패키징 단계는 `bundle_dmg.sh`에서 실패하고 있어, 배포 패키지 흐름은 아직 정리되지 않았습니다

즉, 지금 기준으로는 `pnpm tauri dev`로 실행하는 개발 흐름은 가능하고, macOS에서는 debug `.app` 번들도 생성되지만, 최종 설치 패키지 배포 상태는 아닙니다.

## 자주 쓰는 명령어

```bash
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm format
pnpm tauri dev
pnpm tauri build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 저장과 보안

연결 정보는 OS의 로컬 앱 데이터 디렉터리 아래 `view-table` 폴더에 저장됩니다.

- `connections.json`: 연결 및 그룹 정보
- `.key`: 비밀번호 암호화 키

비밀번호는 AES-256-GCM으로 암호화해서 저장하며, Unix 계열에서는 저장 파일 권한을 `0600`으로 제한합니다.
