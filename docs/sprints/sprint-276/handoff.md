# Sprint 276 Handoff — Unsupported adapter UI hide

- 종료일: 2026-05-13
- Phase: 17 (sprint 0 / Generator-free)
- 단일 commit (orchestrator 직접 패치 — harness 풀 워크플로 미가동, 작업 규모 작음).

## 배경

사용자 요청 ("동작 안 하는 어댑터는 사용자한테 안 보이게 숨겨라. 최소한
새로운 connection 을 만들 때는 숨겨라").

백엔드 `src-tauri/src/commands/connection.rs::make_adapter` 가 실제
어댑터를 반환하는 DBMS = `PostgreSQL` / `MongoDB` 두 개뿐. 나머지
(`MySQL` / `SQLite` / `Redis`) 는 `AppError::Unsupported` 를 반환하지만
프론트엔드는 5개 옵션을 모두 노출하고 있어 사용자가 unsupported DBMS 를
선택할 수 있었다 (선택해도 connect 실패하지만 — UX 노이즈).

Phase 17 (MySQL 어댑터) 본체 진입 전에 dropdown 정리 — supported 리스트가
바뀌면 자동으로 UI 가 풀린다.

## 변경

### 신규 (types)

- `src/types/connection.ts`:
  - `SUPPORTED_DATABASE_TYPES: readonly DatabaseType[] = ["postgresql", "mongodb"]` — 단일 source.
  - `isSupportedDatabaseType(t)` helper.
  - `DATABASE_TYPE_LABELS: Record<DatabaseType, string>` — 모든 variant 라벨 (URL 거부 메시지에서도 사용).

### UI 분기

- `ConnectionDialogBody.tsx` — `<SelectContent>` 5 SelectItem 하드코드 →
  `SUPPORTED_DATABASE_TYPES.map(...)`. 편집 모드에서 기존 connection 의
  `db_type` 이 unsupported 일 경우 자기 자신만 예외적으로 노출
  (select 가 빈값으로 보이지 않도록 보호).

### URL 파싱 거부

- `useConnectionUrlImport.ts`:
  - `parseAndApply` (URL 모드 Parse & Continue) — parser 가 인식한
    `db_type` 이 unsupported 면 `urlError` 세팅 + return false. 메시지:
    `"<Label> is not yet supported. Currently only PostgreSQL / MongoDB
    can be added."` (SUPPORTED 리스트와 자동 동기).
  - `handleHostPaste` (form-mode paste) — unsupported scheme 검출 시
    silent return (AC-178-04 의 silent 룰 그대로 적용; URL 모드만 명시
    거부).

## 테스트

### 추가

- `types/connection.test.ts` — `SUPPORTED_DATABASE_TYPES` / `isSupportedDatabaseType` / `DATABASE_TYPE_LABELS` 3 케이스.
- `ConnectionDialog.test.tsx`:
  - `dropdown exposes only supported adapters (PG + Mongo)` × 1
  - `edit mode preserves an unsupported db_type` × 1
  - `URL Parse & Continue rejects unsupported scheme with explanatory error` × 3 (mysql/sqlite/redis)
  - `PG ↔ Mongo port-guard` × 2 (auto-update + custom-port modal)
- `ConnectionDialog.urlInput.test.tsx` — `unsupported paste is silent` × 4 (mysql/mariadb/redis/sqlite)

### Skip (Phase 17 합류 시 unskip)

- `ConnectionDialog.test.tsx`:
  - 단독 `updates database type and port when selecting MySQL` (1)
  - `describe.skip("Sprint 108: DB type change port guard")` (7 — 시나리오가 MySQL/SQLite 옵션 클릭 의존)
  - `Sprint 138: ... MySQL / SQLite / Redis` 3 케이스

총 11 `it.skip` — 라벨에 "Sprint 276 — Phase 17 합류 시 unskip" 사유 박힘.

## 검증

- `pnpm vitest run` → 269 files / 3286 tests / 10 skipped — 통과.
- `pnpm tsc --noEmit` → 0 errors.
- `pnpm lint` → 0 errors.
- pre-commit hook (no-secrets / rust-format / ts-format / rust-clippy /
  ts-lint / ts-typecheck / rust-coverage / conventional) 통과.

## 미달 / 후속

- Sprint 108 의 port-guard PG↔MySQL/SQLite 시나리오는 일괄 skip — Phase 17
  Sprint (MySQL 어댑터 합류) 에서 unskip 시 회귀 가드 자동 복원.
- 같은 정책을 backend `make_adapter` 에 단단히 박을 후속 — 현재는 backend
  가 `Unsupported` 를 반환하는 수동 매핑. 신규 어댑터 추가 시 UI / 백엔드
  / `SUPPORTED_DATABASE_TYPES` 3 곳을 같이 갱신.

## 관련

- 사용자 요청: 2026-05-13 채팅 메시지.
- Phase 17 진행 상황: `docs/PLAN.md` row 17.
- 다음 Sprint: Phase 17 본체 (F-Refactor Part 1 — `ConnectionConfig` variant).
