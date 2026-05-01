# Phase 23: Safe Mode (프로덕션 가드)

> **상태: 종료 (Sprint 185–188, 2026-05-01)** — TablePlus 패리티 7단계
> 중 3단계 완료. Phase 22 게이트 위에 색상 + 룰 한 겹 + Mongo aggregate
> `$out` / `$merge` 가드 + `useSafeModeGate` helper hook 추출까지 적용.

## 배경

TablePlus 의 차별 기능 중 가장 정량적 가치가 큰 것이 Safe Mode — 프로덕션
연결에서 `WHERE` 없는 `DELETE` / `UPDATE` 가 즉시 실행되지 않도록 막는
게이트. Phase 22 가 모든 mutation 을 "Preview SQL → Commit" 으로 통과시
키므로, 그 위에 색상 기반 룰 한 겹만 더하면 사실상 패리티 달성.

근거: [`docs/tableplus-comparison.md`](../tableplus-comparison.md) Section H#3,
TablePlus `gui-tools/code-review-and-safemode/safe-mode.md`.

## 범위

- **Production 색 연결 식별** — 기존 `connectionColor.ts` 의 PALETTE 위에
  "production" 의미 색상 매핑. ConnectionConfig 에 `safety_level: "safe" |
  "warn" | "strict"` 또는 색상 기반 자동 판정 (사용자 설정으로 override 가능).
- **WHERE-less DML 자동 차단** — Phase 22 의 Preview 게이트에서 SQL 정적
  분석 → `DELETE FROM x` / `UPDATE x SET …` 처럼 `WHERE` 가 없는 statement
  탐지 시 strict 모드는 차단, warn 모드는 추가 confirm.
- **DDL 명시 confirm** — `DROP TABLE` / `TRUNCATE` / `ALTER TABLE … DROP`
  은 production 에서 입력 typing confirm (테이블명 재입력).
- **게이트 다이얼로그 색띠** — Preview 다이얼로그 헤더에 연결 색띠 노출,
  production 은 명확히 식별.
- **Safe Mode 토글 버튼** — 워크스페이스 toolbar 에 현재 모드 표시 + 클릭
  토글. strict 모드가 기본값.

## Out of Scope

- **DRY-RUN 실행** (트랜잭션 시작 → ROLLBACK 으로 영향 행 수만 표시) —
  Phase 후순위.
- **DDL diff 시각화** (변경 전/후 스키마) — Phase 후순위.
- **시간 기반 가드** (업무 시간 외 차단) — out.
- **사용자별 권한 프로필** — 본 Phase 는 색상 기반만.

## 작업 단위 (실행 결과)

- **Sprint 185** — SQL 정적 분석기 + production 식별 + Preview 색띠 +
  strict/warn/safe 모드 토글 + DDL typing confirm. RDB 4 사이트 inline
  gate (DataGrid edit, EditableQueryResultGrid, ColumnsEditor,
  ConstraintsEditor).
- **Sprint 186** — IndexesEditor inline gate 추가 (RDB 5 사이트 기준선).
  `ConfirmDangerousDialog` aria-label 1차 정정.
- **Sprint 187** — Document paradigm 진입 정찰 + RDB 가드 정합성 audit.
- **Sprint 188** — Mongo aggregate `$out` / `$merge` 가드 + paradigm-
  agnostic `useSafeModeGate` hook 추출 (Mongo 1 사이트 consume). 기존 RDB
  5 사이트 inline gate 유지 — hook 마이그레이션은 Sprint 189 후속.

## Exit Criteria (달성 결과)

- production 연결에서 `DELETE FROM x` 단독 statement 가 strict 모드에서
  실행되지 않음 (테스트 통과). ✅
- `DROP TABLE` 은 production 에서 typing confirm 없이 실행 불가. ✅
- Mongo aggregate `$out` / `$merge` 가 production strict 모드에서
  block, warn 모드에서 confirm. ✅
- 모드 토글 상태가 윈도우 간 동기 (Sprint 152 cross-window bridge). ✅

## 후속

- **Sprint 189** — RDB 5 사이트 inline gate 를 `useSafeModeGate` 로
  마이그레이션 (Phase 23 closure refactor). 회귀 risk 격리 단위.
  [`docs/refactoring-plan.md`](../refactoring-plan.md) 의 Sprint 189 항목.
- **Sprint 198** — Mongo bulk-write Tauri command 신규 (Phase 신설 안 함
  — Phase 24 = Index Write UI 와 명명 충돌 회피).
- **단건 mutate 정책** — `insert_document` / `update_document` /
  `delete_document` 단건 + RDB row-level single delete 통합 정책 결정 후속.
