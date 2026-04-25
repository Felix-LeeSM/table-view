# Sprint Contract: sprint-90

## Summary

- Goal: `QuickLookPanel` 의 컬럼명/타입 단일 행 표시를 2줄 분리해 좁은 폭(176px) 에서 정보 손실 없이 읽히도록.
- Audience: Generator + Evaluator
- Owner: Generator
- Verification Profile: `command` (jsdom + RTL 로 DOM 구조/className 단언; spec 의 browser 는 실제 layout 검증 의도지만 jsdom 에선 boundingClientRect=0 이므로 className/구조 단언으로 대체)

## In Scope

- `src/components/shared/QuickLookPanel.tsx`: 컬럼명/타입 inline span 2개를 `flex flex-col` 래퍼로 분리.
- `src/components/shared/QuickLookPanel.test.tsx`: 2줄 분리 단언 + 시각 위계 단언 추가.

## Out of Scope

- 다른 패널 (CellDetailDialog, BlobViewer, SchemaTree) 레이아웃 변경.
- QuickLookPanel 너비 자체 (`w-44` → `w-48`) 는 spec 권고 — Generator 판단으로 유지/완화 둘 다 허용.
- 컬럼명 truncate 정책 자체 변경 (BLOB 표시, JSON pre 등 기존 기능).

## Invariants

- 기존 `QuickLookPanel.test.tsx` 의 모든 happy-path 단언 통과 (값 렌더, BLOB 버튼, JSON pre, NULL/empty 표시, 등) — 회귀 0.
- 다른 컴포넌트 변경 0.
- `CLAUDE.md`, `memory/`, sprint-88/89 산출물 변경 0.

## Acceptance Criteria

- `AC-01` 한 컬럼 행 내부에서 컬럼명과 데이터 타입이 별개의 형제 블록으로 렌더 — 부모가 `flex flex-col` 또는 동등 클래스, 두 자식이 별개 element.
- `AC-02` 긴 데이터 타입 (`character varying(255)`, `timestamp with time zone`) 입력 시 컬럼명 텍스트가 truncate 되지 않고 원본 그대로 노출 — RTL `getByText("긴 컬럼명")` 으로 정확히 매칭.
- `AC-03` 컬럼명은 `font-mono` + `text-xs`, 타입은 `text-3xs` + `opacity-60` 클래스를 가짐 — `className` 단언.
- `AC-04` 기존 `QuickLookPanel.test.tsx` 의 happy-path 단언이 모두 통과.

## Design Bar / Quality Bar

- 신규 단언은 className 기반 + 구조 기반 (둘 중 하나만으로는 부족할 수 있음).
- 긴 타입 케이스에 `text-3xs` 단축 단언이 가능하다면 전체 truncate 검증 단언과 함께.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 0 failures.
2. `pnpm tsc --noEmit` — exit 0.
3. `pnpm lint` — exit 0.
4. `grep -n "flex flex-col\|font-mono\|text-3xs\|opacity-60" src/components/shared/QuickLookPanel.tsx` — 1+ 라인.
5. `grep -n "긴\|long\|character varying\|timestamp with time zone" src/components/shared/QuickLookPanel.test.tsx` — 신규 단언 케이스 존재.

### Required Evidence

- Generator: changed files + 명령 출력 + 단언 라인 인용.
- Evaluator: AC 별 라인 인용 + 기존 테스트 회귀 0 검증.

## Test Requirements

### Unit Tests (필수)
- 2줄 분리 단언 ≥ 1 (구조 + className).
- 긴 타입 케이스 ≥ 1 (truncate 없음).
- 시각 위계 단언 ≥ 1.

### Coverage Target
- 신규 코드 라인 70%+.

### Scenario Tests (필수)
- [x] Happy path: 정상 컬럼명 + 짧은 타입
- [x] 경계 조건: 매우 긴 타입 + 매우 긴 컬럼명
- [x] 회귀 없음: 기존 BLOB/JSON/NULL 케이스 통과

## Test Script / Repro Script

1. `pnpm vitest run -- QuickLookPanel`
2. `pnpm tsc --noEmit`
3. 결과 확인.

## Ownership

- Generator: 단일 agent.
- Write scope: contract In Scope 만.
- Merge order: 단일 PR.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `findings.md`
