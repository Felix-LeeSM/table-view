# Phase 2: Schema & Data Exploration

> 스키마 탐색과 데이터 조회 — **완료**

## 구현 항목

| Feature | ID | 우선순위 |
|---------|-----|---------|
| 데이터베이스/스키마 트리 (F2.1) | F2.1 | P0 |
| 테이블 목록 (F2.2) | F2.2 | P0 |
| 테이블 구조 - 컬럼 (F2.3) | F2.3 | P0 |
| 제약조건 뷰 (F2.5) | F2.5 | P1 |
| 인덱스 뷰 (F2.4) | F2.4 | P1 |
| 데이터 그리드 뷰 (F3.1) | F3.1 | P0 |
| 필터링 (F3.4 기본) | F3.4 | P1 |
| 정렬 (F3.5) | F3.5 | P1 |

## F2.1: 데이터베이스/스키마 트리

- [x] 활성 연결의 데이터베이스 목록이 트리로 표시됨
- [x] 데이터베이스 노드 확장 시 스키마 목록 표시 (PostgreSQL)
- [x] 스키마 노드 확장 시 객체 카테고리 표시: Tables, Views, Functions, Procedures
- [x] 현재 선택된 데이터베이스/스키마 하이라이트
- [ ] 우클릭 컨텍스트 메뉴: 새 객체 생성, 삭제, 새로고침 *(테이블 Drop/Rename/Structure/Data, 스키마 Refresh 구현됨 — 새 객체 생성 미구현)*
- [x] 연결 수준과 스키마/테이블 수준의 시각적 분리
- [x] 각 계층 레벨에 서로 다른 아이콘 스타일 적용
- [x] 스키마 섹션에 섹션 헤더 또는 구분자 표시

## F2.2: 테이블 목록

- [x] 선택한 스키마의 모든 테이블이 목록으로 표시됨
- [x] 테이블 이름 옆에 row count 표시 (옵션)
- [x] 테이블 클릭 시 데이터 탭 열림
- [x] 테이블 우클릭: Structure, Data, Drop, Rename
- [x] 테이블 이름으로 검색/필터링 가능

## F2.3: 테이블 구조 (Columns)

- [x] "Structure" 탭에서 컬럼 목록 표시: Name, Type, Nullable, Default
- [x] Comment 컬럼 표시 (col_description)
- [x] Primary Key 컬럼에 키 아이콘 표시
- [x] Foreign Key 컬럼에 FK 아이콘 및 참조 테이블 정보 표시
- [x] 컬럼 추가/수정/삭제 가능 (ALTER TABLE 실행)
- [x] 변경 사항 preview 후 실행 (Code Review)

## F2.4: 인덱스 뷰

- [x] 테이블 Structure 탭에 Indexes 서브탭 존재
- [x] 인덱스 목록: Name, Columns, Type (B-tree, Hash, etc.), Unique
- [x] 인덱스 생성/삭제 가능
- [x] CREATE INDEX SQL 미리보기

## F2.5: 제약조건 뷰

- [x] Constraints 서브탭에서 제약조건 목록 표시
- [x] 유형별 분류: Primary Key, Foreign Key, Unique, Check (NOT NULL은 Columns 탭 Nullable 컬럼으로 확인)
- [x] FK의 참조 대상(referenced table/column) 표시
- [x] 제약조건 추가/삭제 가능

## F3.1: 데이터 그리드 뷰

- [x] 테이블 선택 시 데이터가 그리드(표) 형태로 표시됨
- [x] 컬럼 헤더에 컬럼명과 데이터 타입 표시
- [x] 컬럼 폭 조절 가능 (드래그)
- [x] 가로 스크롤로 많은 컬럼 탐색 가능
- [x] NULL 값이 시각적으로 구분되어 표시됨

## F3.4: 필터링

- [x] 행 필터: 특정 컬럼의 값으로 행 필터링 (버튼 토글)
- [x] Cmd+F 단축키로 필터바 토글
- [x] 다중 조건 필터 (AND 조합)
- [x] 연산자: =, !=, >, <, >=, <=, LIKE, IS NULL, IS NOT NULL
- [x] 필터 초기화 버튼
- [x] Raw SQL 필터 모드 (사용자가 WHERE 절 조건 직접 입력)
- [x] 필터 값 타입 캐스팅 (bigint, integer 등 숫자 컬럼에 문자열 바인딩 시 자동 캐스트)

## F3.5: 정렬

- [x] 컬럼 헤더 클릭으로 ASC/DESC 정렬 토글
- [x] 다중 컬럼 정렬 지원 (Shift+Click)
- [x] 현재 정렬 상태가 컬럼 헤더에 화살표로 표시됨

## Phase 완료 기준

- [x] 연결 시 사이드바에 DB → Schema → Tables 트리 전개
- [x] 테이블 선택 시 Structure 탭과 Data 탭 열림
- [x] Data 탭에서 페이지네이션된 데이터 그리드 표시
- [x] 컬럼 정렬 및 기본 필터 동작
- [x] ASC/DESC 정렬 토글
- [x] FilterBar/DataGrid/schemaStore/raw SQL 검증 단위·컴포넌트·스토어 테스트 통과 (`pnpm test`)
- [x] 다중 컬럼 정렬

## 검증

연결 후 사이드바에서 DB → Schema → Table 탐색 → Structure/Data 탭 동작
