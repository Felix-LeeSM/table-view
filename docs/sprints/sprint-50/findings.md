# Sprint 50 Findings

## Score: 8.4/10

## Dimension Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 8/10 | 8개 AC 중 7개 초기 구현 완료, AC-06(P1) post-evaluation fix |
| Test Coverage | 8/10 | 21개 신규 테스트 (16 단위 + 5 통합), AC-06 실제 page 변경 테스트로 수정 완료 |
| Code Quality | 9/10 | 깔끔한 Set<number> 기반 상태 관리, 명확한 4분기 제어 흐름 |
| Backward Compatibility | 9/10 | selectedRowIdx 파생 속성으로 하위 호환성 유지 |
| Architecture | 9/10 | 훅 → 테이블 → 툴바 → DataGrid 계층 분리 명확 |

## Findings

### [P1 → RESOLVED] AC-06: Page change resets selection
- **Issue**: `useDataGridEdit` 훅에 `page` prop 변경 시 선택 상태를 초기화하는 `useEffect`가 누락됨
- **Fix**: `useEffect(() => { setSelectedRowIds(new Set()); setAnchorRowIdx(null); }, [page])` 추가
- **Test Fix**: `handleDiscard()` 테스트를 `rerender({ page: 2 })` 기반 page 변경 테스트로 교체
- **Status**: RESOLVED — 728 tests pass

### [P2 → RESOLVED] Misleading AC-06 test
- **Issue**: 원래 테스트가 "AC-06: Page change resets selection"이라고 주장하면서 `handleDiscard()`를 테스트함
- **Fix**: `renderHook`을 `initialProps` 기반으로 변경하여 `rerender`로 page prop 변경 시뮬레이션
- **Status**: RESOLVED

### [P3 → NOTED] anchorRowIdx not updated on Cmd+Click deselect
- **Issue**: Cmd+Click으로 앵커 행의 선택을 해제해도 anchorRowIdx는 변경되지 않음
- **Impact**: Shift+Click 시 선택 해제된 앵커 기준으로 범위 선택 (표준 동작, 대부분의 테이블 뷰가 동일)
- **Status**: NOTED — 의도적 동작, 향후 변경 필요시 수정

## Verdict: PASS
