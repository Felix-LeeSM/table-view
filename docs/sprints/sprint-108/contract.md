# Sprint Contract: sprint-108

## Summary
- Goal: ConnectionDialog 의 DB type 변경 시, 현재 port 가 사용자 정의 (i.e. `DATABASE_DEFAULTS` 값들 중 어느 하나도 아님) 이면 ConfirmDialog 로 "기본 port 로 덮어쓸까?" 확인. 기본 port 또는 빈 값이면 즉시 자동 갱신. 취소 시 dbType 원복 + port 유지.
- Profile: `command`

## In Scope
- `src/components/connection/ConnectionDialog.tsx`:
  - 신규 state: `pendingDbTypeChange: { from: DatabaseType; to: DatabaseType; preservedPort: number } | null`.
  - `handleDbTypeChange(newDbType)` 변경:
    - 현재 `form.port` 가 `DATABASE_DEFAULTS[oldDbType]` 또는 0 또는 빈 값이면 → 자동 갱신 (기존 동작 유지).
    - 그렇지 않으면 (커스텀 port) → `setPendingDbTypeChange({...})`. dbType 즉시 갱신하지 않음. port 도 유지.
  - 확인 모달 (sprint-95 `ConfirmDialog` preset):
    - title: "Replace custom port?".
    - message: "Switching from {oldDbType} to {newDbType} will reset port {preservedPort} → {DATABASE_DEFAULTS[newDbType]}. Continue?"
    - confirmLabel: "Use default port {DATABASE_DEFAULTS[newDbType]}".
    - Confirm → dbType + paradigm + port 갱신 후 모달 닫음.
    - Cancel → 변경 없음 (dbType 원복, port 유지). 모달 닫음.
  - paradigm 도 dbType 갱신 시 함께 갱신 (기존 동작).
- 테스트:
  - 기본 port (5432, postgres) + dbType 변경 (mysql) → port 자동 갱신 (3306), 모달 안 뜸.
  - 커스텀 port (15432) + dbType 변경 → ConfirmDialog 표시.
  - "Use default port" → dbType=mysql, port=3306.
  - "Keep port" → dbType=mysql, port=15432.
  - 빈 port (0) + dbType 변경 → 자동 갱신.
  - 회귀: 기존 ConnectionDialog 테스트 통과.

## Out of Scope
- DB type 별 host placeholder 변경.
- URL mode 의 DB type 변경 (URL 파싱 결과로 적용되는 경우는 별도).
- Mongo connection string 형식 검증.

## Invariants
- 회귀 0 (1787 통과 유지).
- ConfirmDialog 는 sprint-95 preset 사용 (ad-hoc Radix Dialog 금지).
- paradigm 갱신은 dbType 갱신과 항상 동기화.

## Acceptance Criteria
- AC-01: 기본 port (5432) + postgres → mysql 변경 → port 자동으로 3306 변경, 모달 미표시.
- AC-02: 빈/0 port + dbType 변경 → port 자동 갱신, 모달 미표시.
- AC-03: 커스텀 port (예: 15432) + dbType 변경 → ConfirmDialog 표시. dbType / port 즉시 변경 안 됨.
- AC-04: ConfirmDialog Confirm → dbType=새값, paradigm=새값에 맞춤, port=DATABASE_DEFAULTS[새값].
- AC-05: ConfirmDialog Cancel → dbType=원래값(원복), port=원래 커스텀 port 유지, paradigm=원래값.
- AC-06: 회귀 0.

## Verification Plan
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Exit Criteria
- All checks pass + AC-01..06 evidence in handoff.md.
