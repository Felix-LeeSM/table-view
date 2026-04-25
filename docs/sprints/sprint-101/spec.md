# Sprint 101: Mongo 컬렉션 read-only 배너 (P1 #7)

**Source**: `docs/ui-evaluation-results.md` P1 #7
**Depends on**: —
**Verification Profile**: browser

## Goal

MongoDB 컬렉션 탭 상단에 P0 읽기 전용 배너를 노출해 편집 시도 차단을 사용자에게 안내한다.

## Acceptance Criteria

1. MongoDB 컬렉션 탭 상단에 배지/배너로 "Read-only — editing not yet supported" 가 노출된다 (편집 가능 시점에는 조건부 비활성).
2. 배너는 dismissible 하지 않고, 탭 전환/재진입 시에도 일관되게 보인다.
3. RDB 탭에는 배너가 표시되지 않는다.
4. 배너 텍스트는 i18n 친화적인 위치(상수 파일 또는 문구 모음)에 둔다.

## Components to Create/Modify

- `src/components/document/`: 컬렉션 탭 상단 배너 컴포넌트.
- 관련 테스트.
