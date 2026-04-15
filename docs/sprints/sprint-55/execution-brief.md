# Sprint Execution Brief: Sprint 55

## Objective
- Rust 백엔드에 Views, Functions, Procedures 조회 명령어 추가
- SchemaTree에서 실제 데이터 표시 (현재 "No X found" placeholder)

## Task Why
- DB 관리 도구에서 뷰/함수/프로시저 탐색은 필수 기능
- SchemaTree에 이미 카테고리가 존재하므로 데이터만 연결하면 됨

## Scope Boundary
- Rust: list_views, list_functions, list_procedures, get_view_definition, get_function_source
- Frontend: SchemaTree 카테고리에 실제 데이터 로드
- 뷰 데이터 탐색은 기존 query_table_data 재사용
- 뷰 컬럼 조회는 기존 get_table_columns 재사용

## Invariants
- 기존 829개 프론트엔드 테스트 통과
- 기존 157개 Rust 테스트 통과
- list_tables 동작 변경 없음
- E2E 테스트 통과

## Done Criteria
1. `cargo test` 통과 (기존 + 신규 Rust 테스트)
2. `pnpm vitest run` 통과 (829+)
3. `pnpm build` 통과
4. SchemaTree Views 카테고리에 실제 뷰 목록 표시
5. SchemaTree Functions 카테고리에 실제 함수 목록 표시
6. 뷰 클릭 시 Structure/Data 탭 동작
7. 함수 클릭 시 소스 코드 표시
