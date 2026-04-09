# Phase 2 P1 구현 리뷰 — 2026-04-09

> Phase 2 P1(F2.3, F2.4, F2.5, F3.4) 구현 후 PLAN.md와 실제 코드 비교 및 개선점 정리.

---

## 1. PLAN 체크박스 부정확 항목

### 1.1 `[x]`로 표시되었으나 완전히 구현되지 않은 항목

| PLAN 항목 | ID | 표시 | 실제 상태 | 비고 |
|-----------|-----|------|-----------|------|
| 정렬 (Phase 2 요약) | F3.5 | `[x]` | 부분 구현 | ASC만 가능, DESC 토글 없음. 정렬 해제만 지원 |
| Cmd+F 필터 단축키 | F3.4 | `[x]` | 미구현 | 필터 토글이 버튼 클릭으로만 동작 |
| Structure 탭 Comment 컬럼 | F2.3 | `[x]` | 미구현 | ColumnInfo 모델에 comment 필드 없음. UI에도 미표시 |
| NOT NULL 제약조건 | F2.5 | `[x]` | 부정확 | Constraints 탭에 NOT NULL 미표시. Columns 탭 Nullable 컬럼으로 대체 |

### 1.2 `[ ]`로 표시되었으나 부분 구현된 항목

| PLAN 항목 | ID | 표시 | 실제 상태 |
|-----------|-----|------|-----------|
| 정렬 화살표 표시 | F3.5 | `[ ]` | 부분 구현 — 활성 컬럼에 `▲` 표시. 단, 방향 전환(▲/▼) 없음 |
| 가로 스크롤 | F3.1 | `[ ]` | `overflow-auto` 적용되어 있으나 테이블이 `w-full`이라 컬럼이 많을 때만 동작 |

---

## 2. 코드 이슈 (버그 / UX)

### B1. StructurePanel — 첫 로드 전 빈 상태 메시지 깜빡임

- **현상**: `columns`/`indexes`/`constraints` 초기값이 `[]`이고, `loading` 초기값이 `false`라서
  `fetchData()`가 실행되기 전에 "No columns found"가 잠깐 렌더링됨
- **파일**: `src/components/StructurePanel.tsx` (line 284-292)
- **해결 방안**: `hasFetched` 상태를 추가하여 첫 fetch 전에는 "No X found"를 표시하지 않음

### B2. DataGrid — 탭 전환 시 page 리셋 안 됨

- **현상**: `connectionId`, `table`, `schema` prop이 변경되어도 `page` state가 1로 리셋되지 않음.
  정렬 변경(`handleSort`)에서는 `setPage(1)`을 호출하지만 탭 전환 시에는 없음
- **파일**: `src/components/DataGrid.tsx`
- **해결 방안**: `connectionId`, `table`, `schema` 변경 시 `useEffect`에서 `setPage(1)` 실행

### B3. SchemaTree — handleTableClick 불필요한 사이드이펙트

- **현상**: 동일 테이블을 다시 클릭하면 `addTab(data)` → 이미 존재 → 활성화,
  `addTab(structure)` → 이미 존재 → 활성화, `setActiveTab(data)` → 다시 활성화.
  3번의 불필요한 상태 업데이트 발생
- **파일**: `src/components/SchemaTree.tsx` (line 59-92)
- **해결 방안**: data 탭이 이미 존재하면 early return

### B4. FilterBar — Clear All이 appliedFilters를 초기화하지 않음

- **현상**: FilterBar에서 "Clear All"은 `filters` 상태만 비움. `appliedFilters`는 DataGrid가 관리하므로
  Clear All → 닫기 시 이전 필터가 여전히 적용된 상태로 혼란 가능
- **파일**: `src/components/FilterBar.tsx` (line 57-59), `src/components/DataGrid.tsx`
- **해결 방안**: Clear All에 `onClearAll` 콜백을 추가하여 `appliedFilters`도 같이 초기화

---

## 3. 기능 개선 권장 사항 (향후 스프린트)

### I1. 정렬 3단계 토글 (ASC → DESC → 없음)

- **현재**: `null ↔ columnName` 2단계. 항상 ASC
- **개선**: `null → ASC → DESC → null` 3단계 토글
- **필요 변경**: DataGrid `sortColumn: string | null` → `sort: { column: string, direction: "ASC" | "DESC" } | null`,
  Rust `query_table_data`에 `order_direction` 파라미터 추가
- **관련 파일**: `DataGrid.tsx`, `postgres.rs`, `commands/schema.rs`, `tauri.ts`

### I2. StructurePanel 데이터 캐싱

- **현재**: 서브탭 전환 시마다 매번 API 호출
- **개선**: 한 번 불러온 데이터는 같은 테이블에서 재사용 (컴포넌트 state 유지)
- **필요 변경**: `StructurePanel`에서 `fetched` 상태를 서브탭별로 관리

### I3. Cmd+F 필터 단축키

- **현재**: 필터 토글이 버튼 클릭으로만 가능
- **개선**: 전역 키보드 단축키(Cmd+F)로 필터바 토글
- **필요 변경**: DataGrid에 `useEffect`로 키보드 이벤트 리스너 추가

### I4. ColumnInfo에 comment 필드 추가

- **현재**: `comment` 필드가 모델에 없음
- **개선**: PostgreSQL `col_description()`으로 컬럼 코멘트 조회
- **필요 변경**: `schema.rs`(Rust), `schema.ts`(TS), `postgres.rs` 쿼리, `StructurePanel.tsx` 컬럼 추가

---

## 4. PLAN.md 체크박스 정정 권장

다음 항목의 체크박스를 실제 구현 상태에 맞게 조정:

```
# F2.3 — "Comment" 항목 분리
- [x] "Structure" 탭에서 컬럼 목록 표시: Name, Type, Nullable, Default
+ [ ] Comment 컬럼 표시 (col_description 필요)

# F2.5 — NOT NULL 명시
- [x] 유형별 분류: Primary Key, Foreign Key, Unique, Check
  (NOT NULL은 Columns 탭의 Nullable 컬럼으로 확인 가능)

# F3.4 — 단축키 분리
- [x] 행 필터: 특정 컬럼의 값으로 행 필터링 (버튼 토글)
- [ ] Cmd+F 단축키로 필터바 토글

# F3.5 — Phase 2 요약
- [x] 컬럼 정렬 (ASC 전용) 및 기본 필터 동작
- [ ] ASC/DESC 토글, 다중 컬럼 정렬
```
