# 코드 스멜 / 리팩토링 후보 분석 (2026-05-02)

> **Status: 시한부 / Frozen snapshot (2026-05-02).** Sprint 189–198
> sequencing 의 입력 자료. **갱신하지 않는다** — 코드 변화로 라인 번호 /
> 라인 수가 빠르게 stale 해짐. Sprint 진행 중 새 smell 발견 시 본 문서
> 가 아닌 해당 sprint 의 `findings.md` 에 기록. Sprint 198 closure 직후
> `docs/refactoring-plan.md` 와 함께 retire.

이 문서는 현재 코드베이스를 “전체적으로 훑어보며” 리팩토링 필요 신호(코드 스멜)를 정리한 메모입니다.
정답/처방전이 아니라, **어디가 위험 구간인지**를 빠르게 공유하고 **리팩토링 백로그**를 만들기 위한 목적입니다.

---

## 1) 범위 / 관찰 방법

- 범위
  - 프론트: `src/**` (React + Zustand + Tauri IPC)
  - 백엔드: `src-tauri/src/**` (Rust + Tauri commands + DB adapters)
- 관찰 휴리스틱(스멜)
  - 파일/모듈이 너무 큼 (God file)
  - SRP 위반: UI + 네트워크/캐시 + 상태머신 + 도메인 로직 혼재
  - 스토어 내부 구현을 컴포넌트가 직접 조작(결합도↑)
  - 중복 로직/상수/유틸 산재(DRY 위반)
  - 에러 무시(`catch(() => {})`), 훅 deps 무시 등 미래 회귀 포인트
  - 테스트 비대/패턴 불일치(유지비용↑)

---

## 2) 1차 핫스팟(크기/책임 과중)

> 아래 파일들은 “길이” 자체가 문제라기보다, **너무 많은 책임이 한 곳에 모여 있어 변경 파급이 큰 지점**입니다.

- `src/components/schema/SchemaTree.tsx` (~1963 lines)
  - 스키마 로딩/프리패치/캐시 + 트리 UI(선택/확장/검색) + 컨텍스트 메뉴 + rename/delete 다이얼로그까지 한 파일에 혼재.
  - 컴포넌트에서 스토어 캐시를 직접 무효화: `useSchemaStore.setState`로 `tables/views/functions` 엔트리를 `delete`함.
    - 예: `src/components/schema/SchemaTree.tsx:598`
- `src/components/query/QueryTab.tsx` (~1233 lines)
  - SQL 실행 + Mongo find/aggregate + Safe Mode 게이트 + 히스토리/즐겨찾기 + 에디터/결과 UI까지 한 컴포넌트에 결합.
  - “실행 중인 쿼리인지(queryId) 확인 후 결과 반영” 같은 동시성 가드를 UI 컴포넌트가 직접 보유.
    - 예: `src/components/query/QueryTab.tsx:279`
- `src/components/datagrid/useDataGridEdit.ts` (~1160 lines)
  - 하나의 훅이 RDB(SQL 생성/검증/커밋) + Document(MQL 프리뷰/커밋)을 `paradigm` 분기로 모두 처리.
    - 예: `src/components/datagrid/useDataGridEdit.ts:209`
- `src/components/datagrid/DataGridTable.tsx` (~1071 lines)
  - 가상화/컬럼 리사이즈/컨텍스트 메뉴/셀 렌더링/복사 포맷/스크롤 제어 등이 한 컴포넌트에 결합.
- `src/components/connection/ConnectionDialog.tsx` (~829 lines)
  - 주석에 “escape hatch”로 정당화가 있지만, 폼/검증/테스트/저장/에러 마스킹 등 책임이 큼.
- `src/stores/tabStore.ts` (~825 lines)
  - 타입 정의 + 퍼시스턴스 + 상태머신 + 브릿지 attach + selector helper까지 혼재.
- 구조 편집기 3종
  - `src/components/structure/ColumnsEditor.tsx` (~756)
  - `src/components/structure/ConstraintsEditor.tsx` (~628)
  - `src/components/structure/IndexesEditor.tsx` (~558)
  - “SQL 프리뷰 → Safe Mode 검사 → confirm → 실행 → refresh” 패턴이 유사하게 반복됨(공통화 여지 큼).

---

## 3) 스토어/컴포넌트 결합도 스멜 (직접 `setState`)

### 3.1 컴포넌트가 스토어의 내부 구조를 직접 조작

- `src/components/schema/SchemaTree.tsx:598`
  - UI 레이어에서 `useSchemaStore.setState((state) => { ...delete ... })`로 캐시 엔트리를 직접 제거.
  - 문제: 캐시 키 규칙/무효화 규칙/불변식이 UI에 새어 나와서, 스토어 구조 변경 시 UI 전체로 파급.
- `src/components/query/QueryTab.tsx:279`
  - UI가 “현재 탭이 running인지 + queryId가 일치하는지”를 검사한 뒤 `tabs` 배열을 map으로 교체.
  - 문제: 상태 전이 규칙이 분산되면(스토어 일부, UI 일부), 동시성 버그/회귀가 생기기 쉬움.

**권장 방향**
- “의도를 드러내는 스토어 액션”으로 캡슐화:
  - 예: `schemaStore.evictSchemaCache(connectionId, schemaName)`
  - 예: `tabStore.completeQuery(tabId, queryId, result)` / `tabStore.failQuery(...)`

### 3.2 모듈 로드 시점 부수효과(IPC bridge attach)

스토어들이 import되는 순간 브릿지를 attach하는 패턴이 존재합니다.

- `src/stores/connectionStore.ts:426`
- `src/stores/tabStore.ts:733` (workspace-only guard는 있으나, 여전히 모듈 로드 부수효과)
- `src/stores/favoritesStore.ts:157`

**리스크**
- 테스트/번들링/초기화 순서에 민감해질 수 있음.
- “스토어를 단순히 타입/함수로 import했을 뿐인데 side-effect가 발생”하는 패턴은 디버깅 비용이 커짐.

---

## 4) 중복 로직 / 상수 산재 (DRY 위반 후보)

### 4.1 BLOB 판별 로직 중복

- `src/components/shared/QuickLookPanel.tsx:11`
- `src/components/datagrid/DataGridTable.tsx:82`

→ 공용 유틸(예: `src/lib/db/cellFormat.ts`)로 단일화 여지.

### 4.2 row key 생성 로직 중복/불일치 위험

- 공용 함수 존재: `src/components/datagrid/useDataGridEdit.ts:31` (`rowKeyFn(rowIdx, page)`)
- 별도 구현: `src/components/datagrid/DataGridTable.tsx:515` (`const rowKeyFn = (rowIdx) => ...`)

→ 삭제/선택/페이지 이동/새 행 추가 등에서 키 규칙이 어긋나면 디버깅이 어려워짐.

### 4.3 페이지 크기 상수 중복

- `src/components/rdb/DataGrid.tsx:37` (`DEFAULT_PAGE_SIZE = 300`)
- `src/components/document/DocumentDataGrid.tsx:30` (`DEFAULT_PAGE_SIZE = 300`)

→ 공통 상수화(“그리드 정책”)로 일관성 확보 가능.

### 4.4 Safe Mode 게이트 로직의 산재/반복

다음과 같은 패턴이 여러 영역에 등장합니다.

- (조건) connectionEnvironment === "production" && safeMode !== "off"
- (로직) SQL/배치를 statement로 쪼개 `analyzeStatement`로 위험 판별
- (결과) strict는 block, warn은 confirm dialog, off는 통과

대표 예:
- `src/components/structure/ColumnsEditor.tsx:516`
- `src/components/datagrid/useDataGridEdit.ts:872` (commit 시 분석)

→ 공용 게이트(유틸/훅)로 묶으면 중복 제거 + 정책 변경이 쉬워짐.

---

## 5) 에러 처리 스멜: 조용한 실패(`catch(() => {})`)

일부 경로는 실패를 완전히 삼키고(로그/토스트/리트라이 정책 없이) 계속 진행합니다.

- 다수 발생: `src/components/schema/SchemaTree.tsx` (loadSchemas/loadTables 등)
- 예시 패턴:
  - `loadTables(...).catch(() => {})`
  - `.catch(() => {}).finally(...)`

**리스크**
- 장애가 “아무 일도 안 일어남”으로 보이게 되어 사용자/개발자 모두 원인 파악이 어려움.
- 실패 시 UI가 어떤 상태여야 하는지 계약이 불명확해짐.

**권장 방향**
- 최소한 (a) 사용자 토스트, (b) 개발 로그(개발 모드), (c) 재시도 버튼/상태 표기 중 하나는 선택해서 일관된 패턴으로 적용.

---

## 6) Hook deps 무시(회귀 포인트)

`react-hooks/exhaustive-deps` 무시가 몇 군데 존재합니다.
정당화 주석이 있더라도, 주변 코드가 바뀌면 쉽게 회귀가 발생하는 편이라 리팩토링 우선순위가 올라갑니다.

- `src/components/schema/SchemaTree.tsx:519`
- `src/components/datagrid/DataGridTable.tsx:552`
- `src/components/rdb/DataGrid.tsx:116`
- `src/components/document/DocumentDatabaseTree.tsx:230`

**권장 방향**
- 이벤트 핸들러/콜백을 `useCallback`으로 안정화하거나, “최신 참조”만 필요하면 `useEvent`/ref 패턴으로 deps 정상화를 목표.

---

## 7) 타입 안정성 스멜 (`any`, 동적 구조)

### 7.1 SQL 자동완성 네임스페이스의 `any` 확산

- `src/hooks/useSqlAutocomplete.ts:120`
  - CodeMirror 네임스페이스 구조가 동적이라 `Record<string, any>`가 다수 등장.

**리스크**
- 리팩토링 시 타입이 안전망 역할을 못해 회귀가 빨리 발생할 수 있음.

**권장 방향**
- 내부 빌더용 최소 타입을 정의해 `any` 전파를 차단(“외부로 새지 않게”).

---

## 8) 테스트 스멜

### 8.1 초대형 테스트 파일

다음 파일들은 시나리오가 한 파일에 과밀하게 들어간 형태로 보입니다.

- `src/components/schema/SchemaTree.test.tsx` (~2721 lines)
- `src/components/query/QueryTab.test.tsx` (~2296 lines)
- `src/components/schema/StructurePanel.test.tsx` (~2156 lines)

**리스크**
- 작은 UI/상태 변경에도 연쇄적으로 많은 테스트가 흔들릴 가능성이 큼.
- 유지보수 비용이 증가하고, 테스트가 “리팩토링을 막는 장벽”이 되기 쉬움.

### 8.2 죽은 테스트 유틸(미사용 정황)

- `src/test-utils.tsx`
  - `createTauriMock`, `resetStore`, `renderWithProviders`가 현재 import되지 않는 정황.

**선택지**
- (A) 테스트 표준 패턴으로 채택해서 반복되는 `vi.mock("@lib/tauri")`/스토어 초기화를 공용화
- (B) 계속 미사용이면 제거/정리해 혼란 줄이기

---

## 9) Rust/Tauri 백엔드 대형 모듈 스멜

길이가 큰 파일들이 어댑터/쿼리/스키마/헬퍼를 한 곳에 누적한 형태로 보입니다.

- `src-tauri/src/db/postgres.rs` (~3684 lines)
- `src-tauri/src/db/mongodb.rs` (~1809 lines)
- `src-tauri/src/commands/connection.rs` (~1710 lines)
- `src-tauri/src/db/mod.rs` (~1317 lines)

**권장 방향(점진)**
- 예: `db/postgres/schema.rs`, `db/postgres/query.rs`, `db/postgres/ddl.rs`, `db/postgres/guards.rs` 식으로 “변경 축” 기준 모듈화.
- 목표: 변경 영향 범위 축소 + 리뷰/테스트 단위 축소.

---

## 10) 추천 리팩토링 로드맵(작은 PR 단위)

> 실제 리팩토링은 “작게, 계약(테스트) 유지하며”가 안전합니다.

1. **중복 유틸/상수 단일화**
   - `isBlobColumn`, `DEFAULT_PAGE_SIZE`, `rowKeyFn`부터 단일 소스로 이동
2. **스토어 액션으로 캡슐화(직접 setState 제거)**
   - `SchemaTree`의 캐시 무효화, `QueryTab`의 query state 반영을 스토어로 이관
3. **Safe Mode 게이트 공용화**
   - 구조 편집/그리드 커밋/쿼리 실행의 정책을 한 곳으로 모으기
4. **God 컴포넌트 분해**
   - `SchemaTree`(데이터 훅 + UI 컴포넌트로 분리)
   - `QueryTab`(실행 오케스트레이션 분리)
5. **백엔드 모듈 분할**
   - Postgres/Mongo 어댑터를 기능 축 기준으로 분리

