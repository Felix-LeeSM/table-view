# Sprint Execution Brief: sprint-90

## Objective

`QuickLookPanel` 의 컬럼명/타입 단일 행 표시를 2줄로 분리해 좁은 폭(176px) 에서 정보 손실 없이 읽히도록 한다.

## Task Why

P1 사용자 리포트 (#QL-2). 좁은 너비에 컬럼명 + 데이터 타입이 한 줄로 묶여 truncate 가 일어나 사용자가 전체 정보를 못 봄.

## Scope Boundary

**쓰기 허용**:
- `src/components/shared/QuickLookPanel.tsx`
- `src/components/shared/QuickLookPanel.test.tsx`

**쓰기 금지**:
- 다른 컴포넌트, 다른 패널 (CellDetailDialog, BlobViewer 등)
- sprint-88/89 산출물
- `CLAUDE.md`, `memory/`

## Invariants

- 기존 happy-path (값 렌더, BLOB, JSON, NULL/empty) 회귀 0.
- 다른 파일 변경 0.

## Done Criteria

1. 컬럼명/타입이 별개 형제 블록으로 렌더 (부모 `flex flex-col`).
2. 긴 타입 (`character varying(255)`, `timestamp with time zone`) 입력 시 컬럼명 truncate 없이 노출.
3. 컬럼명 `font-mono`+`text-xs`, 타입 `text-3xs`+`opacity-60` 시각 위계 유지.
4. 기존 테스트 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `grep` 으로 변경 클래스 + 신규 단언 케이스 확인
- Required evidence:
  - 변경 파일 + 목적
  - 명령 출력 + AC 별 라인 인용

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- AC coverage with evidence
- Assumptions / risks

## References

- Contract: `docs/sprints/sprint-90/contract.md`
- Spec: `docs/sprints/sprint-90/spec.md`
