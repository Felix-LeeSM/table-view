# View Table — Definition of Done (DoD)

> TablePlus-like database management tool built with Tauri + React + Rust.
> 이 문서는 구현 중 "길을 잃지 않기 위한" 종합 가이드입니다.

---

## Context

TablePlus와 같은 로컬 데이터베이스 관리 도구를 만듭니다. 여러 DB 연결을 관리하고, 테이블/스키마를 탐색하며, SQL 쿼리를 작성·실행할 수 있어야 합니다.

**핵심 제약:**
- Tauri + React + Rust 기반 데스크톱 앱
- 로컬 실행 (인증 불필요, 연결 정보는 로컬 파일에 저장)
- 초기 DBMS: PostgreSQL (확장 가능 아키텍처)
- Tauri 2.0으로 모바일 확장 가능성 열어둠

---

## Architecture Overview

```
┌──────────────────────────────────┐
│          Tauri 2.0 App           │
├──────────────────────────────────┤
│   WebView (React + TypeScript)   │
│   ┌──────────┬────────────────┐  │
│   │ Sidebar  │   Main Area    │  │
│   │ ──────── │ ────────────── │  │
│   │ Conns    │ Tab Bar        │  │
│   │ Schema   │ ┌────────────┐ │  │
│   │ Tree     │ │ Query      │ │  │
│   │          │ │ Editor     │ │  │
│   │          │ ├────────────┤ │  │
│   │          │ │ Result     │ │  │
│   │          │ │ Grid       │ │  │
│   │          │ └────────────┘ │  │
│   └──────────┴────────────────┘  │
├──────────────────────────────────┤
│   Rust Backend (Tauri Commands)  │
│   ┌────────────────────────────┐ │
│   │ DB Driver Layer            │ │
│   │  ├─ PostgresAdapter        │ │
│   │  └─ trait DbAdapter (ext.) │ │
│   ├────────────────────────────┤ │
│   │ Connection Manager         │ │
│   │  └─ Local JSON storage     │ │
│   ├────────────────────────────┤ │
│   │ Query Executor             │ │
│   │  └─ Async, cancellable     │ │
│   ├────────────────────────────┤ │
│   │ Schema Introspector        │ │
│   │  └─ information_schema     │ │
│   └────────────────────────────┘ │
├──────────────────────────────────┤
│   Local File System              │
│   ~/.view-table/                 │
│   ├─ connections.json            │
│   ├─ preferences.json            │
│   ├─ query-history.json          │
│   └─ favorites/                  │
└──────────────────────────────────┘
```

---

## Feature Areas & Acceptance Criteria

### FA-1: Connection Management (연결 관리)

#### F1.1: 연결 생성
- **Done when:**
  - [x] "New Connection" 버튼/메뉴로 연결 생성 다이얼로그 열림
  - [x] 입력 필드: Name, Host, Port, User, Password, Database
  - [x] PostgreSQL 기본값 자동 설정 (Port: 5432)
  - [x] "Test Connection" 버튼으로 연결 가능 여부 확인
  - [x] 테스트 성공 시 "Connection successful" 녹색 표시
  - [x] 테스트 실패 시 에러 메시지 표시 (연결 거부, 인증 실패 등)
  - [x] "Save" 시 유효한 연결만 저장됨
  - [x] 동일 이름 연결 생성 시 경고
  - [x] 비밀번호는 로컬 파일에 암호화(OsRng + AES-256-GCM) 저장
  - [x] URL 형태(`postgresql://user:pass@host:port/db`)로 import 가능

#### F1.2: 연결 목록 및 그룹핑
- **Done when:**
  - [x] 저장된 모든 연결이 사이드바에 목록으로 표시됨
  - [x] 연결을 폴더(그룹)로 정리 가능 (예: "Production", "Development")
  - [x] 드래그앤드롭으로 연결을 그룹 간 이동 가능
  - [x] 그룹 생성/수정/삭제 가능
  - [x] 빈 그룹도 유지 가능

#### F1.3: 연결 수정 및 삭제
- **Done when:**
  - [x] 연결 우클릭 → "Edit"으로 수정 다이얼로그 열림
  - [x] 기존 값이 폼에 프리필되어 표시됨
  - [x] "Test Connection" 후 저장 가능
  - [x] 연결 우클릭 → "Delete"로 삭제 (확인 다이얼로그 포함)
  - [x] 활성 연결 삭제 시 연결 먼저 종료 후 삭제

#### F1.4: 연결 태그 및 색상
- **Done when:**
  - [ ] 연결에 색상 라벨 지정 가능 (Red, Orange, Yellow, Green, Blue, Purple)
  - [ ] 사이드바에서 색상이 시각적으로 표시됨
  - [ ] 환경 태그 지정 가능: Local, Testing, Development, Staging, Production
  - [ ] 태그로 필터링 가능

#### F1.5: 연결 상태 관리
- **Done when:**
  - [x] 연결 더블클릭 또는 "Connect" 버튼으로 활성화
  - [x] 활성 연결은 녹색 인디케이터로 표시
  - [x] 연결 해제(disconnect) 가능
  - [x] 연결 끊김 시 자동 감지 및 재연결 시도
  - [x] 연결 타임아웃 설정 가능 (기본 300초)
  - [x] Keep-alive ping (기본 30초 간격)으로 유휴 연결 유지

---

### FA-2: Schema Explorer (스키마 탐색기)

#### F2.1: 데이터베이스/스키마 트리
- **Done when:**
  - [x] 활성 연결의 데이터베이스 목록이 트리로 표시됨
  - [x] 데이터베이스 노드 확장 시 스키마 목록 표시 (PostgreSQL)
  - [ ] 스키마 노드 확장 시 객체 카테고리 표시: Tables, Views, Functions, Procedures
  - [ ] 현재 선택된 데이터베이스/스키마 하이라이트
  - [ ] 우클릭 컨텍스트 메뉴: 새 객체 생성, 삭제, 새로고침

#### F2.2: 테이블 목록
- **Done when:**
  - [x] 선택한 스키마의 모든 테이블이 목록으로 표시됨
  - [x] 테이블 이름 옆에 row count 표시 (옵션)
  - [x] 테이블 클릭 시 데이터 탭 열림 (FA-3 참조)
  - [ ] 테이블 우클릭: Structure, Data, Drop, Rename
  - [ ] 테이블 이름으로 검색/필터링 가능

#### F2.3: 테이블 구조 (Columns)
- **Done when:**
  - [x] "Structure" 탭에서 컬럼 목록 표시: Name, Type, Nullable, Default
  - [x] Comment 컬럼 표시 (col_description)
  - [x] Primary Key 컬럼에 키 아이콘 표시
  - [x] Foreign Key 컬럼에 FK 아이콘 및 참조 테이블 정보 표시
  - [ ] 컬럼 추가/수정/삭제 가능 (ALTER TABLE 실행)
  - [ ] 변경 사항 preview 후 실행 (Code Review)

#### F2.4: 인덱스 뷰
- **Done when:**
  - [x] 테이블 Structure 탭에 Indexes 서브탭 존재
  - [x] 인덱스 목록: Name, Columns, Type (B-tree, Hash, etc.), Unique
  - [ ] 인덱스 생성/삭제 가능
  - [ ] CREATE INDEX SQL 미리보기

#### F2.5: 제약조건 뷰
- **Done when:**
  - [x] Constraints 서브탭에서 제약조건 목록 표시
  - [x] 유형별 분류: Primary Key, Foreign Key, Unique, Check (NOT NULL은 Columns 탭 Nullable 컬럼으로 확인)
  - [x] FK의 참조 대상(referenced table/column) 표시
  - [ ] 제약조건 추가/삭제 가능

#### F2.6: 뷰(Views) 탐색
- **Done when:**
  - [ ] Views 카테고리에 모든 뷰 목록 표시
  - [ ] 뷰 선택 시 Structure 탭에서 컬럼 정보 표시
  - [ ] 뷰의 정의 SQL 확인 가능 (pg_views)
  - [ ] 뷰 데이터 탐색 가능 (테이블 브라우저와 동일 UX)

#### F2.7: Functions & Procedures
- **Done when:**
  - [ ] Functions 목록: Name, Return Type, Argument Types
  - [ ] 함수 정의(source code) 확인 가능
  - [ ] 함수 생성/수정/삭제 가능 (SQL 에디터로)

---

### FA-3: Table Browser (테이블 브라우저)

#### F3.1: 데이터 그리드 뷰
- **Done when:**
  - [x] 테이블 선택 시 데이터가 그리드(표) 형태로 표시됨
  - [x] 페이지네이션 지원 (기본 100 rows/page)
  - [x] 컬럼 헤더에 컬럼명과 데이터 타입 표시
  - [x] 컬럼 폭 조절 가능 (드래그)
  - [ ] 컬럼 순서 변경 가능 (드래그앤드롭)
  - [x] 가로 스크롤로 많은 컬럼 탐색 가능
  - [x] NULL 값이 시각적으로 구분되어 표시됨
  - [ ] BLOB/Binary 데이터는 아이콘으로 표시, 클릭 시 상세 보기

#### F3.2: 인라인 편집
- **Done when:**
  - [ ] 셀 더블클릭 시 편집 모드 진입
  - [ ] 텍스트, 숫자, boolean, 날짜/시간 타입 편집 가능
  - [ ] 편집 중인 셀이 시각적으로 구분됨 (노란색 배경)
  - [ ] Tab/Enter로 다음 셀로 이동
  - [ ] Escape로 편집 취소
  - [ ] 변경 사항은 즉시 DB에 반영되지 않고 "pending" 상태로 표시
  - [ ] "Commit" 버튼(Cmd+S)으로 변경 일괄 실행
  - [ ] "Discard" 버튼으로 모든 보류 변경 취소
  - [ ] Commit 전 생성되는 SQL 미리보기 (Code Review)

#### F3.3: 행(Row) 조작
- **Done when:**
  - [ ] "Add Row" 버튼으로 빈 행 삽입
  - [ ] 행 선택 후 "Delete Row"로 삭제 (pending 상태)
  - [ ] "Duplicate Row"로 선택한 행 복제 삽입
  - [ ] 여러 행 동시 선택 가능 (Shift+Click, Cmd+Click)
  - [ ] 선택한 행 복사 (Cmd+C): Plain text, JSON, CSV, SQL Insert 형식
  - [ ] 우클릭 컨텍스트 메뉴: Edit, Delete, Duplicate, Copy as...

#### F3.4: 필터링
- **Done when:**
  - [x] 행 필터: 특정 컬럼의 값으로 행 필터링 (버튼 토글)
  - [x] Cmd+F 단축키로 필터바 토글
  - [x] 다중 조건 필터 (AND 조합)
  - [x] 연산자: =, !=, >, <, >=, <=, LIKE, IS NULL, IS NOT NULL
  - [ ] 다중 조건 필터 (OR 조합)
  - [ ] 필터 조건이 생성하는 WHERE 절 SQL 미리보기
  - [x] 필터 초기화 버튼
  - [x] Raw SQL 필터 모드 (사용자가 WHERE 절 조건 직접 입력)
  - [x] 필터 값 타입 캐스팅 (bigint, integer 등 숫자 컬럼에 문자열 바인딩 시 자동 캐스트)
  - [ ] 컬럼 헤더 우클릭 → "Filter by this column" 빠른 필터

#### F3.5: 정렬
- **Done when:**
  - [x] 컬럼 헤더 클릭으로 ASC/DESC 정렬 토글
  - [ ] 다중 컬럼 정렬 지원 (Shift+Click)
  - [ ] 현재 정렬 상태가 컬럼 헤더에 화살표로 표시됨

#### F3.6: 데이터 상세 보기 (Quick Look)
- **Done when:**
  - [ ] 행 선택 시 하단 또는 사이드 패널에 전체 필드 표시
  - [ ] JSON 데이터 포맷팅되어 표시
  - [ ] 큰 텍스트 필드 스크롤 가능한 텍스트 영역으로 표시
  - [ ] BLOB 데이터 hex viewer 또는 이미지로 표시

---

### FA-4: Query Editor (쿼리 에디터)

#### F4.1: SQL 에디터 기본
- **Done when:**
  - [ ] SQL 입력 영역이 monospace 폰트로 표시됨
  - [ ] 구문 하이라이팅: 키워드(파랑), 문자열(초록), 숫자(주황), 주석(회색)
  - [ ] 줄 번호 표시
  - [ ] 들여쓰기 자동 적용
  - [ ] 괄호 자동 닫기 및 매칭 하이라이트
  - [ ] Cmd+Return으로 현재 쿼리(또는 커서 위치 쿼리) 실행
  - [ ] Cmd+Shift+Return으로 전체 쿼리 실행
  - [ ] 세미콜론(;)으로 여러 쿼리 구분 가능

#### F4.2: 쿼리 실행 및 결과
- **Done when:**
  - [ ] 실행된 쿼리의 결과가 하단 그리드에 표시됨
  - [ ] 결과 그리드는 테이블 브라우저(FA-3)와 동일한 UX
  - [ ] 실행 시간 표시 (예: "245ms, 1,234 rows")
  - [ ] 쿼리 실행 중 로딩 스피너 표시
  - [ ] 장시간 실행 쿼리 취소 가능 (Cancel 버튼 또는 Cmd+.)
  - [ ] 에러 발생 시 빨간색 에러 메시지 표시 (라인 번호 포함)
  - [ ] DML(INSERT/UPDATE/DELETE) 실행 시 "N rows affected" 표시
  - [ ] DDL 실행 시 "Query executed successfully" 표시

#### F4.3: 다중 탭
- **Done when:**
  - [ ] 탭 바에 열린 탭 목록 표시
  - [ ] 새 탭 생성 버튼(Cmd+T)
  - [ ] 탭 닫기(X 버튼, Cmd+W)
  - [ ] 탭 간 전환 시 각 탭의 쿼리 내용과 결과 유지
  - [ ] 탭에 연결 정보(색상) 표시
  - [ ] 서로 다른 연결의 탭을 동시에 열어둘 수 있음
  - [ ] 앱 재시작 시 이전 탭 상태 복원

#### F4.4: 자동완성
- **Done when:**
  - [ ] 테이블 이름 자동완성 (스키마 접두사 포함)
  - [ ] 컬럼 이름 자동완성 (테이블 컨텍스트 기반)
  - [ ] SQL 키워드 자동완성 (SELECT, FROM, WHERE, JOIN...)
  - [ ] 함수 이름 자동완성
  - [ ] 자동완성 목록에 타입/설명 부가 정보 표시
  - [ ] Tab/Enter로 자동완성 선택

#### F4.5: 쿼리 포맷팅
- **Done when:**
  - [ ] Cmd+I: SQL Beautify (들여쓰기, 줄바꿈으로 정렬)
  - [ ] Cmd+Shift+I: SQL Uglify (한 줄로 압축)
  - [ ] 포맷팅이 선택 영역에만 적용 가능

#### F4.6: 쿼리 히스토리
- **Done when:**
  - [ ] 모든 실행 쿼리가 자동으로 히스토리에 기록됨
  - [ ] 히스토리 패널에서 과거 쿼리 검색 가능
  - [ ] 과거 쿼리 클릭 시 에디터에 삽입
  - [ ] 연결별 히스토리 분리
  - [ ] 히스토리 항목에 실행 시간, 타임스탬프 표시

#### F4.7: 쿼리 즐겨찾기
- **Done when:**
  - [ ] 쿼리를 "Favorites"에 저장 가능 (이름 지정)
  - [ ] 저장된 즐겨찾기 목록에서 쿼리 재사용
  - [ ] 키워드 바인딩으로 빠른 호출 (예: /daily → 저장된 쿼리)
  - [ ] 연결별 또는 전역 즐겨찾기 구분

#### F4.8: 결과 분할
- **Done when:**
  - [ ] 에디터와 결과 패널을 수평/수직 분할 가능
  - [ ] 여러 쿼리 실행 시 결과를 개별 탭으로 표시
  - [ ] 결과 탭을 닫지 않고 유지 가능 (최대 10개)

---

### FA-5: Global UX (전역 사용자 경험)

#### F5.1: 단축키
- **Done when:**
  - [ ] Cmd+N: 새 연결
  - [ ] Cmd+T: 새 쿼리 탭
  - [x] Cmd+W: 현재 탭 닫기
  - [ ] Cmd+S: Commit changes
  - [ ] Cmd+P: Quick Open (테이블/뷰/함수 검색)
  - [x] Cmd+F: 필터
  - [x] Cmd+R / F5: 컨텍스트 새로고침
  - [ ] Cmd+Return: 쿼리 실행
  - [ ] Cmd+.: 쿼리 취소
  - [ ] Cmd+,: 설정 열기

#### F5.2: Quick Open (Cmd+P)
- **Done when:**
  - [ ] Cmd+P로 퍼지 검색 다이얼로그 열림
  - [ ] 테이블, 뷰, 함수, 프로시저 검색 가능
  - [ ] 검색 결과 선택 시 해당 객체 탐색

#### F5.3: 콘솔 로그
- **Done when:**
  - [ ] Cmd+Shift+C로 콘솔 패널 열림
  - [ ] 모든 실행된 쿼리가 타임스탬프와 함께 기록됨
  - [ ] 쿼리 로그 복사 가능

#### F5.4: 테마
- **Done when:**
  - [x] Light / Dark 테마 지원
  - [x] 시스템 설정 따르기 (Auto)
  - [x] 테마 변경이 즉시 적용됨

---

## Implementation Phases (구현 단계)

### Phase 1: Foundation (기반)
> Tauri 프로젝트 설정, 기본 UI 레이아웃, 연결 관리

| Feature | ID | 우선순위 |
|---------|-----|---------|
| Tauri + React 프로젝트 초기화 | — | P0 |
| 기본 레이아웃 (Sidebar + Main + Tab Bar) | — | P0 |
| 연결 생성 (F1.1) | F1.1 | P0 |
| 연결 목록 (F1.2 기본) | F1.2 | P0 |
| 연결 수정/삭제 (F1.3) | F1.3 | P0 |
| 연결 상태 관리 (F1.5) | F1.5 | P0 |
| DB Driver 추상화 (trait DbAdapter) | — | P0 |
| PostgreSQL Adapter 구현 | — | P0 |

**Phase 1 Done when:**
- [x] 앱 실행 시 연결 목록 사이드바 표시
- [x] 새 연결 생성 → 테스트 → 저장 → 사이드바에 표시 → 연결/해제 동작
- [x] Rust에서 `trait DbAdapter` 정의되고 PostgreSQL 구현체 존재

**Phase 1 미흡 항목 (Phase 5 또는 후속 처리):**
- [x] F1.1: URL 형태(`postgresql://user:pass@host:port/db`) import
- [x] F1.2: 드래그앤드롭으로 연결 그룹 간 이동 (현재: 우클릭 메뉴로만 이동)
- [x] F1.2: 그룹 Rename 다이얼로그 (현재: TODO stub)
- [x] F1.5: 연결 끊김 자동 감지 및 재연결
- [x] F1.5: 연결 타임아웃 설정 (기본 300초)
- [x] F1.5: Keep-alive ping (기본 30초 간격)
- [x] F5.4: Light/Dark 테마 + 시스템 설정 따르기 (Phase 1에서 선제 구현)

**Phase 1 완전 완료**

### Phase 2: Schema & Data Exploration
> 스키마 탐색과 데이터 조회

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

**Phase 2 Done when:**
- [x] 연결 시 사이드바에 DB → Schema → Tables 트리 전개
- [x] 테이블 선택 시 Structure 탭과 Data 탭 열림
- [x] Data 탭에서 페이지네이션된 데이터 그리드 표시
- [x] 컬럼 정렬 (ASC 전용) 및 기본 필터 동작
- [x] ASC/DESC 정렬 토글
- [ ] 다중 컬럼 정렬

### Phase 3: Query Editor
> 쿼리 작성 및 실행 환경

| Feature | ID | 우선순위 |
|---------|-----|---------|
| SQL 에디터 기본 (F4.1) | F4.1 | P0 |
| 쿼리 실행 및 결과 (F4.2) | F4.2 | P0 |
| 다중 탭 (F4.3) | F4.3 | P0 |
| 쿼리 취소 | F4.2 | P1 |
| 자동완성 (F4.4 기본) | F4.4 | P1 |

**Phase 3 Done when:**
- [ ] 새 쿼리 탭에서 SQL 작성 및 실행
- [ ] 결과 그리드에 데이터 표시
- [ ] 여러 탭에서 서로 다른 연결로 동시 작업
- [ ] 장시간 쿼리 취소 가능

### Phase 4: Editing & Polish
> 인라인 편집, UX 개선

| Feature | ID | 우선순위 |
|---------|-----|---------|
| 인라인 편집 (F3.2) | F3.2 | P0 |
| 행 조작 (F3.3) | F3.3 | P0 |
| Code Review (SQL 미리보기) | F3.2 | P0 |
| 쿼리 포맷팅 (F4.5) | F4.5 | P2 |
| 쿼리 히스토리 (F4.6) | F4.6 | P2 |
| Quick Open (F5.2) | F5.2 | P2 |
| 테마 (F5.4) | F5.4 | P2 |
| 단축키 (F5.1) | F5.1 | P1 |

**Phase 4 Done when:**
- [ ] 데이터 그리드에서 셀 더블클릭 → 편집 → Commit → DB 반영
- [ ] 행 추가/삭제 → Commit 전 SQL 미리보기 → 실행
- [ ] Light/Dark 테마 전환 동작
- [ ] 핵심 단축키 모두 동작

### Phase 5: Extended Features (이후)
> Phase 1-4 완료 후 점진적 추가

| Feature | ID | 비고 |
|---------|-----|------|
| 연결 태그/색상 (F1.4) | F1.4 | |
| 뷰 탐색 (F2.6) | F2.6 | |
| Functions/Procedures (F2.7) | F2.7 | |
| 데이터 상세 보기 (F3.6) | F3.6 | |
| 쿼리 즐겨찾기 (F4.7) | F4.7 | |
| 결과 분할 (F4.8) | F4.8 | |
| 콘솔 로그 (F5.3) | F5.3 | |
| Import/Export | — | CSV, JSON, SQL |
| SSH 터널링 | — | |
| MySQL 지원 | — | DbAdapter 구현체 추가 |
| SQLite 지원 | — | DbAdapter 구현체 추가 |
| 모바일 (Tauri 2.0) | — | 반응형 UI 조정 |

---

## Technical Decisions (기술 결정)

### Rust Crate 선택
| 목적 | Crate | 이유 |
|------|-------|------|
| DB 드라이버 | `sqlx` (async) | 컴파일 타임 쿼리 체크, 다중 DB 지원, async |
| 직렬화 | `serde` + `serde_json` | JSON 설정 파일, Tauri command 통신 |
| 암호화 | `aes-gcm` | 연결 비밀번호 암호화 |
| 에러 처리 | `thiserror` + `anyhow` | 타입 안전 에러 |
| 로깅 | `tracing` | 구조화된 로그 |

### Frontend 라이브러리
| 목적 | 라이브러리 | 이유 |
|------|-----------|------|
| UI 프레임워크 | React + TypeScript | 생태계, Tauri 호환 |
| 상태 관리 | Zustand | 가볍고 단순 |
| SQL 에디터 | CodeMirror 6 | 확장성, 자동완성 플러그인 |
| 데이터 그리드 | AG Grid (Community) 또는 TanStack Table | 가상 스크롤, 편집 지원 |
| 스타일링 | Tailwind CSS | 빠른 프로토타이핑 |
| 아이콘 | Lucide React | 가볍고 일관된 디자인 |

---

## Key Risks & Mitigations

| 리스크 | 영향 | 완화 |
|--------|------|------|
| Tauri 2.0 안정성 | 모바일 확장 지연 | 데스크톱 먼저 완성, Tauri 1.x fallback |
| 대용량 결과 셋 메모리 | UI 멈춤 | 스트리밍, 페이지네이션, 워커 |
| SQL 자동완성 성능 | UX 저하 | 스키마 캐싱, debounce |
| 멀티 DB 추상화 누락 | MySQL 지원 시 리팩토링 | Phase 1에서 trait 설계 철저히 |

---

## Verification (검증 방법)

각 Phase 완료 시 확인 방법:

**Phase 1:** `cargo tauri dev` 실행 → UI 렌더링 → 연결 생성/테스트/저장/연결/해제 동작
**Phase 2:** 연결 후 사이드바에서 DB → Schema → Table 탐색 → Structure/Data 탭 동작
**Phase 3:** 쿼리 탭에서 `SELECT 1` 실행 → 결과 표시 → 다중 탭 동작
**Phase 4:** 데이터 편집 → SQL 미리보기 → Commit → DB에 반영 확인

---

## 참고 자료

- TablePlus 문서: `docs/table_plus/` (63개 문서)
- Tauri 2.0 가이드: https://v2.tauri.app/
- sqlx 문서: https://docs.rs/sqlx
