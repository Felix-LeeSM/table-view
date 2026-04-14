# Sprint Execution Brief: Sprint 54

## Objective
- 스키마 트리 계층별 고유 아이콘 (Connection, Schema, Category, Table)
- 활성 탭 테이블 자동 하이라이트 + 스키마 자동 확장

## Task Why
- 시각적 탐색성 향상
- 현재 작업 중인 테이블을 트리에서 즉시 파악 가능

## Scope Boundary
- SchemaTree.tsx: 아이콘 매핑, 활성 탭 하이라이트, 자동 확장
- tabStore: activeTab의 schema/table 정보 (이미 접근 가능)
- **Hard stop**: DataGrid 변경 없음, Rust 변경 없음

## Invariants
- 기존 테스트 통과
- SchemaTree 컨텍스트 메뉴 동작 유지

## Done Criteria
1. `pnpm tsc --noEmit` 통과
2. `pnpm vitest run` 통과
3. 계층별 고유 아이콘 표시
4. 활성 탭 테이블 하이라이트
5. 해당 스키마 자동 확장
