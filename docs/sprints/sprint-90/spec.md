# Sprint 90: Quick Look 필드 행 2줄 분리 (#QL-2)

**Source**: `docs/ui-evaluation-results.md` #QL-2
**Depends on**: —
**Verification Profile**: browser

## Goal

`QuickLookPanel` 의 컬럼명/타입 단일 행 표시를 2줄 분리해 좁은 폭(176px) 에서 정보 손실 없이 읽히도록 한다.

## Acceptance Criteria

1. 한 컬럼 행 내부에서 컬럼명 노드와 데이터 타입 노드가 별개의 형제 블록으로 렌더된다. 두 노드의 boundingClientRect top 값이 서로 다르다.
2. 긴 데이터 타입(`character varying(255)`, `timestamp with time zone`) 입력 시 컬럼명 텍스트가 truncate 되지 않고 원본 그대로 노출된다.
3. 컬럼명은 `font-mono` + `text-xs`, 타입은 `text-3xs` + `opacity-60` 시각 위계가 유지된다.
4. 기존 `QuickLookPanel.test.tsx` 의 happy path (값 렌더, BLOB 버튼, JSON pre 등) 회귀 0.

## Components to Create/Modify

- `src/components/shared/QuickLookPanel.tsx`: 컬럼명/타입 inline span 두 개를 `flex flex-col` 래퍼로 분리. 좌측 폭은 동일 유지하거나 `w-48` 로 약간 완화.
- `src/components/shared/QuickLookPanel.test.tsx`: 2줄 분리 단언 테스트 추가.
