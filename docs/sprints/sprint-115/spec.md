# Sprint 115: SchemaTree 가상화 (#PERF-2, #TREE-4)

**Source**: `docs/ui-evaluation-results.md` #PERF-2 + #TREE-4
**Depends on**: —
**Verification Profile**: mixed

## Goal

SchemaTree 가 1000+ 테이블에서도 가상화로 DOM 노드 수 상한을 유지해 트리 펼침/스크롤 성능을 보장한다.

## Acceptance Criteria

1. SchemaTree 가 1000+ 테이블에서도 가상화로 DOM 노드 수 상한 유지.
2. 트리 펼침/접힘 시 가상화가 정확하게 재계산된다.
3. 키보드 네비게이션 + F2 rename(sprint 107) 이 가상화 후에도 동일하게 동작한다.
4. 기존 SchemaTree 테스트 회귀 0 (가상화 인지 쿼리 패턴 갱신).

## Components to Create/Modify

- `src/components/schema/SchemaTree.tsx`: 가상화 도입.
- 관련 테스트.
