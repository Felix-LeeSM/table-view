# Sprint 108: ConnectionDialog DB 타입 변경 port 가드 (#CONN-DIALOG-2)

**Source**: `docs/ui-evaluation-results.md` #CONN-DIALOG-2
**Depends on**: sprint-96
**Verification Profile**: mixed

## Goal

ConnectionDialog 에서 DB 타입 변경 시 사용자 정의 port 가 있으면 확인 모달을 띄우고, 기본 port 면 자동 갱신해 사용자가 의도치 않게 port 를 잃지 않게 한다.

## Acceptance Criteria

1. ConnectionDialog 에서 DB 타입 변경 시 사용자 정의 port 가 있으면 "기본 port 로 덮어쓸까?" 확인 모달이 뜬다.
2. port 가 기본값이거나 비어 있으면 자동으로 새 DB 타입의 기본 port 로 갱신된다.
3. 확인 모달에서 취소 시 DB 타입은 원복되고 port 는 유지된다.
4. 기존 ConnectionDialog 테스트 회귀 0.

## Components to Create/Modify

- `src/components/connection/ConnectionDialog.tsx`: DB 타입 변경 가드.
- 관련 테스트.
