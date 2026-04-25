# Sprint 107: SchemaTree F2 rename (#TREE-1)

**Source**: `docs/ui-evaluation-results.md` #TREE-1
**Depends on**: —
**Verification Profile**: browser

## Goal

SchemaTree 테이블 노드에서 F2 키 입력 시 rename 모드로 진입해 키보드 사용자도 컨텍스트 메뉴 없이 rename 을 수행할 수 있게 한다.

## Acceptance Criteria

1. SchemaTree 테이블 노드에 포커스가 있는 상태에서 F2 키를 누르면 rename 모드 진입.
2. rename 입력 필드가 즉시 포커스되며 기존 이름이 선택된 상태로 노출된다.
3. Enter 시 rename 커밋, Esc 시 취소.
4. 기존 SchemaTree 테스트 회귀 0.

## Components to Create/Modify

- `src/components/schema/SchemaTree.tsx`: F2 rename 진입 핸들러.
- 관련 테스트.
