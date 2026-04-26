# Sprint Execution Brief: sprint-129

## Objective

Mongo 코드 경로에서 RDB 가정(`schema/table` aliasing) 제거.
- `TableTab` 확장: `database?: string` / `collection?: string` (둘 다 optional, document 전용).
- `DocumentDatabaseTree` `addTab`이 새 필드를 채움.
- `MainArea` document case가 새 필드 우선 + schema/table fallback.
- `tabStore.loadPersistedTabs`에 backfill 마이그레이션.
- DocumentDatabaseTree 비주얼 정리: Folder 메타포 제거, `Database` 아이콘 단일.
- 신규 search input — db/collection 이름 cross-match.

## Task Why

S125-S128에서 paradigm-aware shell + DB switcher가 갖춰졌지만 mongo 탭은 여전히 RDB 필드 piggyback. S130/S131의 active DB context 변경 작업이 실제 mongo 탭의 database/collection을 바꾸려면 깨끗한 자료 모델이 필요. 또 비주얼적으로 RDB-folder 메타포가 mongo에 그대로 남아 있어 사용자에게 혼란.

## Scope Boundary

- 백엔드 (`src-tauri/`) 변경 금지.
- RDB 탭 자료 모델 변경 금지 — 새 필드는 document 전용.
- SchemaTree 변경 금지.
- DocumentDataGrid 내부 store wire 시그니처 변경 금지 (S130/S131).
- 단축키 / 신규 e2e 추가 금지.
- favorite 기능 추가 금지 (RDB tree에도 없음).

## Invariants

- vitest 1948 + e2e 정적 컴파일 회귀 0.
- TableTab의 `schema?` / `table?`는 보존 — document 탭도 backwards-compat로 같이 채움 (write 시).
- 사용자 시야: PG 동일, Mongo는 search input + 단순화된 db row 비주얼만 추가.
- aria-label 보존, 신규 라벨은 contract 가이드 준수.

## Done Criteria

1. TableTab에 `database?: string` / `collection?: string` 추가.
2. DocumentDatabaseTree `addTab`이 새 필드 채움.
3. MainArea document case가 새 필드 사용 (fallback 한 단계 OK).
4. tabStore.loadPersistedTabs에 document 탭 backfill 마이그레이션.
5. DocumentDatabaseTree 비주얼: Folder 메타포 제거 + Database 아이콘 단일.
6. 신규 search input + 매치 0 시 다른 메시지.
7. 신규 단위 테스트.
8. 검증 명령 5종 그린.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm vitest run` — 1948+ 그린
  2. `pnpm tsc --noEmit` — 0
  3. `pnpm lint` — 0
  4. `pnpm contrast:check` — 0 새 위반
  5. e2e 정적 컴파일 회귀 0
- Required evidence:
  - 각 AC에 file:line / test:line 매핑
  - DocumentDatabaseTree addTab 호출 코드 인용 (database/collection 포함)
  - loadPersistedTabs backfill 코드 인용
  - MainArea fallback 패턴 코드 인용
  - search 매치 0 메시지 RTL 테스트

## Evidence To Return

- Changed files + purpose 한 줄
- 5개 검증 명령 outcome
- AC-01..AC-10 매핑
- 가정 (e.g. "document 탭의 schema/table은 backwards-compat로 함께 set, 점진 제거는 후속")
- 잔여 위험

## References

- Contract: `docs/sprints/sprint-129/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md`
- 직전 sprint findings: `docs/sprints/sprint-128/findings.md`
- Relevant files:
  - `src/stores/tabStore.ts` (`TableTab`, `loadPersistedTabs`)
  - `src/components/schema/DocumentDatabaseTree.tsx`
  - `src/components/layout/MainArea.tsx` (document case)
  - `src/components/document/DocumentDataGrid.tsx` (alias 사이트 — 이번 sprint는 보존)
  - `src/stores/documentStore.ts` (databases / collections 캐시)
