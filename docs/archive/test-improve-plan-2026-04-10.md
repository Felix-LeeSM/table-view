# Test Improvement Plan

> 측정일: 2026-04-10
> 목표: Frontend 전체 60%+, 핵심 파일 70%+ / Rust 단위 테스트 커버리지 측정 후 개선

## 현재 상태

### Frontend (vitest, v8 coverage)
| 지표 | 현재 | 목표 |
|------|------|------|
| 전체 Lines | 39.5% | 60%+ |
| 전체 Functions | 40.0% | 60%+ |
| 전체 Branches | 40.8% | 50%+ |
| 테스트 수 | 124 | 180+ |

### Rust (cargo test)
| 카테고리 | 현재 | 비고 |
|----------|------|------|
| 단위 테스트 | 53 passed | `#[cfg(test)]` 7개 파일 |
| storage 통합 | 12 passed | 로컬 파일 기반 |
| schema 통합 | 12 failed | DB 필요, CI 전용 |
| query 통합 | 별도 측정 필요 | DB 필요 |

---

## Frontend 개선 작업

### Phase 1: 0% 컴포넌트 — 모킹 전략 수립 후 일괄 추가
> 예상 효과: +10~15% 전체 커버리지

| 파일 | 라인 | 우선순위 | 전략 |
|------|------|----------|------|
| QueryEditor.tsx | 114 | P0 | CodeMirror JS DOM 모킹 — EditorView 생성 확인 |
| MainArea.tsx | 98 | P1 | tabStore 상태에 따른 분기 렌더링 |
| SchemaTree.tsx | 169 | P1 | schemaStore/loadSchemas/loadTables mock |
| Sidebar.tsx | 172 | P2 | connectionStore + Sidebar 내부 컴포넌트 mock |
| StructurePanel.tsx | 279 | P2 | column/index/constraint 데이터 mock |

### Phase 2: Connection 컴포넌트 — 폼/이벤트 테스트
> 예상 효과: +5~8%

| 파일 | 라인 | 전략 |
|------|------|------|
| ConnectionDialog.tsx | 378 | 폼 입력, 유효성 검사, Test Connection 흐름 |
| ConnectionItem.tsx | 200 | 우클릭 메뉴, connect/disconnect |
| ConnectionGroup.tsx | 146 | 그룹 확장/축소, rename |
| ConnectionList.tsx | 49 | 목록 렌더링 |
| ContextMenu.tsx | 85 | 포지셔닝, 메뉴 항목 클릭 |

### Phase 3: 기존 테스트 보강
> 예상 효과: +3~5%

| 파일 | 현재 | 목표 | 추가 시나리오 |
|------|------|------|-------------|
| DataGrid.tsx | 66% | 80% | 다중 정렬 해제, 빈 데이터, 페이지 전환 |
| FilterBar.tsx | 74% | 85% | raw SQL 모드, 필터 초기화 |
| QueryTab.tsx | 61% | 80% | 경쟁 조건 상세, 탭 전환 시 상태 보존 |
| connectionStore.ts | 72% | 85% | 이벤트 리스너, keep-alive |

### Phase 4: 유틸/훅
| 파일 | 현재 | 전략 |
|------|------|------|
| tauri.ts | 0% | IPC 래퍼는 mock 기반으로 직접 테스트 불가 — 통합 테스트에서 간접 커버 |
| useTheme.ts | 0% | matchMedia mock으로 테마 전환 |

---

## Rust 개선 작업

### Phase R1: 커버리지 측정 인프라
- [ ] `cargo-tarpaulin` 또는 `cargo-llvm-cov` 설치 및 CI 연동
- [ ] 현재 커버리지 측정

### Phase R2: 단위 테스트 보강
- [ ] `commands/connection.rs` (313줄) — command 핸들러 단위 테스트
- [ ] `commands/schema.rs` (100줄) — command 핸들러 단위 테스트
- [ ] `db/postgres.rs` (948줄) — execute_query, strip_leading_comments 등
- [ ] `storage/mod.rs` (197줄) — 파일 I/O 로직

### Phase R3: 통합 테스트 안정화
- [ ] schema_integration: CI에서만 실행 (`#[ignore]` + `--ignored` 분리)
- [ ] query_integration: 동일 패턴 적용

---

## 세션 분할 계획

| 세션 | 작업 | 예상 커버리지 변화 |
|------|------|-------------------|
| 1 | Phase 1 (QueryEditor, MainArea, SchemaTree) | 40% → 50% |
| 2 | Phase 2 (Connection 컴포넌트) | 50% → 57% |
| 3 | Phase 3 (기존 보강) + Phase 4 | 57% → 63% |
| 4 | Rust Phase R1-R2 | Rust 측정 + 개선 |

---

## 진행 상태

- [x] Frontend 현재 상태 측정
- [x] Rust 현재 상태 측정
- [ ] Frontend Phase 1
- [ ] Frontend Phase 2
- [ ] Frontend Phase 3
- [ ] Frontend Phase 4
- [ ] Rust Phase R1
- [ ] Rust Phase R2
- [ ] Rust Phase R3
