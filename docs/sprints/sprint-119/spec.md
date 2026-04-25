# Sprint 119: MainArea EmptyState MRU 정책 (#SHELL-1)

**Source**: `docs/ui-evaluation-results.md` #SHELL-1
**Depends on**: —
**Verification Profile**: browser

## Goal

MainArea EmptyState 가 "first connected" 가 아닌 MRU(최근 사용) 정책으로 첫 진입을 결정하도록 변경하거나, 정책 결정을 결정 문서화한다.

## Acceptance Criteria

1. MainArea EmptyState 가 "first connected" 가 아닌 MRU(최근 사용) 정책으로 첫 진입을 결정한다 (또는 정책 결정 ADR 추가).
2. MRU 데이터는 영구 저장(localStorage 또는 store) 되어 앱 재시작 후에도 유지된다.
3. MRU 가 비어 있으면(첫 실행) 기존 안내 EmptyState 가 표시된다.
4. 기존 MainArea 테스트 회귀 0.

## Components to Create/Modify

- `src/components/layout/MainArea.tsx`: MRU 정책.
- MRU 저장 store 또는 localStorage 어댑터.
- 관련 테스트.
- (정책 결정 시) `memory/decisions/` ADR 추가.
