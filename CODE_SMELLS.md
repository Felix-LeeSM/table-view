# Code Bad Smell 리포트 (Table View)

작성일: 2026-05-02
목표: “나쁜 냄새(bad smell)” 후보를 넓게 수집하고, 왜 그렇게 보이는지(근거/리스크)를 함께 정리.

> **Status: 시한부 — Sprint 199–N 입력값 전용.** 이전 cycle 의
> `docs/refactoring-smells.md` (2026-05-02 retire) 와 동일한 위상.
> Sprint 199 부터 `docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–...)"
> 섹션이 본 카탈로그를 입력값으로 sprint 매핑 — sequencing 종료 시 본
> 문서 retire. 진행 중 발견된 smell 변경은 본 문서 갱신이 아니라 해당
> sprint findings 에 기록.

> 참고: 이 문서는 **휴리스틱 기반**(grep/규모/패턴 탐지)이라 false positive/false negative가 존재합니다. “정확한 버그 리포트”가 아니라 **리팩터링/품질 개선 우선순위 잡기**를 위한 자료입니다.

---

## 0) 범위/방법

### 스캔 범위
- 대상: `src/`, `src-tauri/src/`, `scripts/`, `e2e/`, `tests/`
- 제외(생성물/대용량): `node_modules/`, `dist/`, `coverage/`, `cargo-target/`, `src-tauri/target/`, `tmp/`

### 사용한 휴리스틱(대표)
- “God file/module”: `wc -l` 기준 라인 수 상위(큰 파일은 냄새가 날 확률이 높음)
- 품질-위험 패턴 grep:
  - React hook 의존성 억제: `eslint-disable-next-line react-hooks/exhaustive-deps`
  - 타입 안정성 우회: `no-explicit-any` 억제 / `as unknown as`
  - 관측가능성/복구 관련: `catch { ... }`, `console.*`
  - 테스트 위생: `it.skip`, `this.skip()`, `.only` 등
  - Rust 강제 종료 위험: `unwrap(` / `expect(` / `panic!(` (테스트 모듈과 분리해서 해석)

### 부가 확인
- `pnpm lint` 실행 결과: **PASS** (출력 없이 exit 0)

---

## 1) 우선순위 높은 구조적 냄새: God 파일/모듈(응집도/복잡도)

“라인 수가 크다 = 무조건 나쁘다”는 아니지만, 유지보수 비용(인지 부하/충돌/테스트 어려움)이 급격히 증가하는 대표 신호입니다.

### 1-1. Frontend(프로덕션) 큰 파일 Top (TS/TSX)
- `src/components/schema/SchemaTree.tsx` (2105 lines)
- `src/components/datagrid/DataGridTable.tsx` (1071 lines)
- `src/components/query/QueryTab.tsx` (1040 lines)
- `src/stores/tabStore.ts` (1002 lines)
- `src/components/document/DocumentDataGrid.tsx` (951 lines)
- `src/components/shared/QuickLookPanel.tsx` (866 lines)
- `src/components/connection/ConnectionDialog.tsx` (829 lines)
- `src/components/structure/ColumnsEditor.tsx` (775 lines)
- `src/components/datagrid/useDataGridEdit.ts` (715 lines)
- `src/lib/tauri.ts` (684 lines)
- `src/components/query/EditableQueryResultGrid.tsx` (655 lines)
- `src/components/structure/ConstraintsEditor.tsx` (649 lines)
- `src/components/rdb/DataGrid.tsx` (621 lines)
- `src/components/schema/DocumentDatabaseTree.tsx` (583 lines)
- `src/components/structure/IndexesEditor.tsx` (579 lines)

**왜 냄새인가(근거/리스크)**
- 단일 파일이 UI 렌더 + 이벤트 처리 + 상태 머신 + 네트워크/IPC + 에러/토스트 + 키보드 단축키까지 함께 품으면 “한 군데 수정 → 다른 곳 깨짐” 가능성이 커짐
- 테스트 작성 시 “셋업 비용”이 커지고, 단위 분리가 어려워져 점점 통합 테스트만 늘어나는 경향
- 파일이 큰 영역일수록 팀 개발에서 merge conflict가 잦아짐

**개선 방향(예시)**
- `SchemaTree.tsx`: (a) 트리 렌더링, (b) DDL 액션(drop/rename/refresh), (c) 검색/필터/auto-expand, (d) 가상화(virtualizer) 등을 훅/서브컴포넌트로 분리
- `QueryTab.tsx`: 실행/취소/히스토리 기록/active DB mutation hint/모달 상태를 “작은 유스케이스 훅”으로 분리해 side-effect를 지역화
- `tabStore.ts`: “타입/마이그레이션/퍼시스턴스/IPC 브릿지/액션 구현”이 한 파일에 공존 → persistence/bridge/migrations를 별도 모듈로 분리 고려

### 1-2. Backend(Rust) 큰 파일 Top
- `src-tauri/src/db/postgres.rs` (3803 lines)
- `src-tauri/src/commands/connection.rs` (1710 lines)
- `src-tauri/src/db/mod.rs` (1425 lines)
- `src-tauri/src/commands/export.rs` (1423 lines)
- `src-tauri/src/commands/meta.rs` (1061 lines)
- `src-tauri/src/storage/mod.rs` (737 lines)
- `src-tauri/src/models/schema.rs` (650 lines)
- `src-tauri/src/db/mongodb/connection.rs` (609 lines)
- `src-tauri/src/db/mongodb/mutations.rs` (530 lines)
- `src-tauri/src/models/connection.rs` (526 lines)
- `src-tauri/src/storage/crypto.rs` (477 lines)

**왜 냄새인가(근거/리스크)**
- DB 어댑터/명령 라우팅/스토리지/모델이 큰 단위로 뭉치면 변경 여파(예: 스키마 조회 사소한 변경이 쿼리 실행/DDL/Export에도 영향)가 커짐
- Rust 쪽은 “실패 처리(에러 타입)”가 설계의 핵심인데, 거대 모듈은 에러 분기와 컨텍스트 전달이 복잡해지기 쉬움

**개선 방향(예시)**
- `db/postgres.rs`: (a) 식별자 검증/인용(quote), (b) 메타데이터(list schemas/tables/views/functions), (c) query execution, (d) ddl, (e) mapping/types 등을 모듈 분리
- `commands/*`: “입력 검증/에러 메시지 규격/권한(세이프모드)/로깅”을 공통 helper로 묶어 중복 제거

---

## 2) React Hooks 의존성 억제(`exhaustive-deps`) — 잠재 버그/회귀 위험

의도적으로 deps를 줄이는 패턴은 성능/계약을 위해 필요할 때도 있지만, “나중에 refactor하면서 의존성이 바뀌면” 조용히 stale closure 버그로 번질 수 있어 냄새로 취급했습니다.

발견 위치(프로덕션):
- `src/components/query/QueryTab.tsx:598` — 의존성에서 일부 액션을 의도적으로 제외(주석으로 계약 설명)
- `src/components/datagrid/DataGridTable.tsx:552` — virtualizer 인스턴스 deps 제외(주석으로 이유 설명)
- `src/components/document/DocumentFilterBar.tsx:488` — columns 변화 감지 deps를 축소
- `src/components/document/AddDocumentModal.tsx:222` — CodeMirror editor 생성 effect에서 deps 축소
- `src/components/rdb/DataGrid.tsx:115`
- `src/components/rdb/FilterBar.tsx:105` — 주석으로 안정성 가정(onFiltersChange stable, columns length로 추적)
- `src/components/schema/DocumentDatabaseTree.tsx:325` — `expandedDbs` deps 제외(무한루프 회피 목적)

**왜 냄새인가(근거/리스크)**
- 린트 규칙을 끄는 순간, “의존성이 바뀌었는데 effect가 재실행되지 않는” 버그를 자동으로 잡기 어려움
- 지금은 안정적이어도(“이 함수는 stable” 가정), 미래 변경으로 안정성이 깨질 수 있음

**완화/개선 방향(선택지)**
- `useEvent`/ref 기반 패턴으로 “deps는 올바르게 포함하되, effect 내부에서 최신 함수를 참조”하도록 구조화
- 상태 업데이트를 가능한 한 “함수형 setState”로 처리해 deps 요구를 줄이기
- “왜 deps를 제외했는지”가 이미 주석으로 남아있는 곳이 많아 좋음. 다만 중요한 곳은 테스트(회귀 방지)로 계약을 고정하면 안정성이 올라감

---

## 3) 타입 안정성 우회(명시적 `any`, 이중 캐스팅) — 안전장치 무력화

### 3-1. 프로덕션 코드에서 `no-explicit-any` 억제 + `any` 사용
- `src/hooks/useSqlAutocomplete.ts:157`
- `src/hooks/useSqlAutocomplete.ts:166`
- `src/hooks/useSqlAutocomplete.ts:190`
- `src/hooks/useSqlAutocomplete.ts:200`
- `src/hooks/useSqlAutocomplete.ts:212`
- `src/hooks/useSqlAutocomplete.ts:215`
- `src/hooks/useSqlAutocomplete.ts:234`

**근거/리스크**
- autocomplete 네임스페이스(“children/self” 구조)가 사실상 동적 타입이 되면서, 잘못된 shape가 들어가도 컴파일러가 막지 못함
- 결과적으로 런타임에서만 깨지고, 회귀가 UI에서 늦게 드러날 수 있음

**개선 방향(예시)**
- CodeMirror completion tree의 최소 인터페이스를 타입으로 정의(“self/children” + 필요한 필드만)하고, `any`를 그 타입으로 대체
- 어쩔 수 없는 부분은 `unknown`→런타임 가드→타입 좁히기(validator)로 “안전한 우회”로 전환

### 3-2. `as unknown as` 이중 캐스팅(프로덕션)
- `src/lib/mongo/mongoAutocomplete.ts:246`
- `src/lib/mongo/mongoAutocomplete.ts:328`

**근거/리스크**
- 외부 라이브러리 타입과 맞지 않을 때 흔히 쓰는 우회지만, 실제 런타임 shape가 다를 경우 크래시/비정상 동작으로 이어짐

**개선 방향(예시)**
- 가능한 경우 라이브러리 타입(`syntaxTree().resolveInner`) 반환 타입을 올바르게 받아들이도록 타입 좁히기(사용하는 필드만 추출) 또는 타입 정의 보강

---

## 4) 관측가능성/복구 관련 냄새: `catch { ... }` “best-effort” 패턴

`catch {}` 자체는 나쁜 게 아니지만, (a) 너무 광범위하게 삼키거나, (b) 중요한 실패가 사용자/로그로 전파되지 않는 경우 냄새로 분류했습니다.

### 4-1. `catch { ... }` 사용 위치(요약)
전체 목록은 부록 A 참고.

**관찰**
- localStorage/환경(Tauri 런타임 부재) 같은 “실패가 정상일 수 있는” 영역에서 방어적으로 삼키는 패턴이 많음  
  예: `src/lib/themeBoot.ts:59`, `src/lib/session-storage.ts:41`, `src/components/layout/Sidebar.tsx:33`
- 일부는 “외부 동작을 깨지 않기 위해” 의도적으로 조용히 no-op 처리  
  예: `src/lib/window-controls.ts:80`, `src/components/query/QueryTab.tsx:129`(verify best-effort)

**왜 냄새인가(근거/리스크)**
- 장애/회귀 발생 시 “원인 추적”이 어려워짐(특히 사용자는 조용히 기본값으로 돌아가며 문제를 인지하지 못할 수 있음)
- 같은 패턴이 곳곳에 퍼지면 “어떤 실패는 토스트로, 어떤 실패는 무시” 같은 정책 일관성이 깨지기 쉬움

**개선 방향(예시)**
- “정상적으로 무시 가능한 실패”와 “개발 환경에서라도 로그가 필요한 실패”를 구분하고, 최소한 DEV에선 중앙화된 로깅 유틸로 수집
- localStorage 접근은 공통 helper로 감싸서 정책(DEV 로그 여부, fallback)을 통일

---

## 5) `console.*` 사용(프로덕션) — 로그 정책/노이즈 리스크

발견 위치(테스트 제외, 주석 포함):
- `src/pages/HomePage.tsx:149` (`console.warn`)
- `src/pages/WorkspacePage.tsx:65` (`console.warn`)
- `src/main.tsx:53` (`console.warn`)
- `src/main.tsx:85` (`console.error`)
- `src/lib/window-controls.ts:44` (`console.warn`)
- `src/lib/window-controls.ts:168` (`console.warn`)
- `src/AppRouter.tsx:99` (`console.warn`)
- `src/lib/window-lifecycle-boot.ts:52` (`console.warn`)
- `src/hooks/useSchemaCache.ts:30` (`console.error`, DEV gate)
- `src/lib/perf/bootInstrumentation.ts:187` (`console.info`, “single-line boot summary”)
- `src/components/shared/ErrorBoundary.tsx:28` (`console.error`)
- `src/components/schema/DocumentDatabaseTree.tsx:227` (`console.error`, DEV gate)
- `src/components/schema/SchemaTree.tsx:677` (`console.error`, DEV gate)
- `src/components/schema/SchemaTree.tsx:737` (`console.error`, DEV gate)

**왜 냄새인가(근거/리스크)**
- 프로덕션에서 콘솔 로그가 누적되면, (a) 중요한 로그가 묻히거나, (b) 사용자 환경에서 불필요한 노이즈가 될 수 있음
- 반대로 “아예 로그가 없으면” 장애 분석이 어려움 → 결국 “정책” 문제

**개선 방향(예시)**
- 현재도 DEV gate(`import.meta.env.DEV`)를 사용하는 곳이 있어 좋음. 가능한 경우 “사용자-facing 토스트 + DEV 로그 + (추후) telemetry”처럼 계층화하면 일관성이 좋아짐
- 부팅 요약(`bootInstrumentation.ts`)처럼 “구조화된 단일 라인”은 유지하되, 필터링(target/tag) 전략을 명확히 하는 것을 권장

---

## 6) 테스트/품질 위생 냄새: Skip/Placeholder 테스트

“나중에 하자”가 코드에 남아있는 형태는 대표적인 냄새입니다(회귀 방지망이 있다고 착각할 수 있음).

### 6-1. 명시적 skip
- `e2e/feedback-2026-04-27.spec.ts:33` — `it.skip(...)`

### 6-2. 런타임 skip(`this.skip()`) 다수
대표:
- `e2e/feedback-2026-04-27.spec.ts:48` / `:78` / `:90` / `:101` / `:156` / `:169` / `:177`
- `e2e/raw-query-db-change.spec.ts:24` / `:30`
- `e2e/db-switcher.spec.ts:34` / `:42` / `:56` / `:58`
- `e2e/connection-switch.spec.ts:108`
- `e2e/keyboard-shortcuts.spec.ts:108`

**왜 냄새인가(근거/리스크)**
- CI에서 “통과”로 보이지만 실제로는 실행되지 않는 케이스가 누적될 수 있음
- 스펙 파일이 남아있으면, 신규 기여자가 “여기 테스트가 있으니 안전”하다고 오해할 수 있음

**개선 방향(예시)**
- placeholder 성격이면 명확히 분리(예: `*.todo.spec.ts`)하거나, CI에서 “스킵 개수 상한”을 둬서 누적을 막기
- 환경 의존(skip on missing env)인 경우, 문서/CI 설정에서 해당 env가 실제로 채워지는지 주기적으로 확인

---

## 7) Rust: 프로덕션에서의 강제 종료(`expect`) 지점

대부분의 `unwrap/expect/panic`은 `#[cfg(test)] mod tests` 아래(테스트 코드)에서 발견되었습니다.  
프로덕션 경로에서 눈에 띄는 강제 종료 지점은 아래입니다:

- `src-tauri/src/lib.rs:280` — `build(context).expect("error while building tauri application")`
- `src-tauri/src/lib.rs:307` — `run(context).expect("error while running tauri application")`

또한 “가정 위반 시 panic 가능” 패턴(프로덕션):
- `src-tauri/src/db/postgres.rs:84` — `chars.next().expect("checked non-empty")` (직전에서 empty 체크를 했다는 가정)
- `src-tauri/src/db/mongodb/schema.rs:138` / `:144` — `expect("inserted above")` (직전 insert 가정)

**왜 냄새인가(근거/리스크)**
- `expect`는 실패 시 즉시 프로세스/스레드 패닉으로 이어질 수 있어, 사용자 입장에서는 “앱이 그냥 죽음”으로 보일 수 있음
- 다만 Tauri 초기화 실패는 “복구 불가능한 치명 오류”로 취급하는 선택도 가능하므로, 여기서는 “정책적 선택인지”가 핵심

**개선 방향(선택지)**
- 치명 오류를 사용자에게 더 친절하게 표출(로그/다이얼로그)하고 종료하는 방식으로 전환(패닉 대신 `Result` 처리)
- “가정 기반 expect”는 디펜시브 코드로 바꾸거나, 최소한 `debug_assert!`로 제한해 release에서의 폭발을 줄이는 선택 검토

---

## 부록 A) `catch {` 전체 목록(테스트 포함 일부)

- `src/types/connection.ts:245`
- `src/stores/connectionStore.ts:35`
- `src/stores/connectionStore.ts:45`
- `src/stores/connectionStore.ts:54`
- `src/stores/tabStore.ts:156`
- `src/stores/tabStore.ts:852`
- `src/stores/mruStore.ts:41`
- `src/stores/mruStore.ts:72`
- `src/stores/mruStore.ts:81`
- `src/stores/mruStore.ts:178`
- `src/stores/schemaStore.ts:282`
- `src/stores/schemaStore.ts:313`
- `src/stores/schemaStore.ts:366`
- `src/stores/connectionStore.test.ts:107`
- `src/stores/favoritesStore.ts:31`
- `src/stores/favoritesStore.ts:41`
- `src/lib/themeBoot.ts:59`
- `src/lib/session-storage.ts:41`
- `src/lib/session-storage.ts:61`
- `src/lib/session-storage.ts:72`
- `src/components/shared/QuickLookPanel.tsx:61`
- `src/components/shared/QuickLookPanel.tsx:70`
- `src/lib/window-label.ts:46`
- `src/components/document/AddDocumentModal.tsx:212`
- `src/components/query/QueryTab.tsx:129`
- `src/components/query/QueryTab.tsx:144`
- `src/components/query/QueryTab.tsx:331`
- `src/lib/perf/bootInstrumentation.ts:75`
- `src/lib/perf/bootInstrumentation.ts:106`
- `src/lib/perf/bootInstrumentation.ts:113`
- `src/lib/window-controls.ts:80`
- `src/lib/window-controls.ts:94`
- `src/components/connection/ImportExportDialog.tsx:234`
- `src/components/connection/ConnectionGroup.tsx:45`
- `src/components/shared/BsonTreeViewer.tsx:42`
- `src/components/shared/BsonTreeViewer.tsx:139`
- `src/components/layout/Sidebar.tsx:33`
- `src/components/layout/Sidebar.tsx:112`
- `src/components/shared/ExportButton.tsx:63`
- `src/components/datagrid/BlobViewerDialog.tsx:70`
- `src/components/datagrid/CellDetailDialog.tsx:25`

---

## 부록 B) 프로덕션 `eslint-disable` 목록(테스트 제외)

- `src/hooks/useSqlAutocomplete.ts:157` (`@typescript-eslint/no-explicit-any`)
- `src/hooks/useSqlAutocomplete.ts:166` (`@typescript-eslint/no-explicit-any`)
- `src/hooks/useSqlAutocomplete.ts:190` (`@typescript-eslint/no-explicit-any`)
- `src/hooks/useSqlAutocomplete.ts:200` (`@typescript-eslint/no-explicit-any`)
- `src/hooks/useSqlAutocomplete.ts:212` (`@typescript-eslint/no-explicit-any`)
- `src/hooks/useSqlAutocomplete.ts:215` (`@typescript-eslint/no-explicit-any`)
- `src/hooks/useSqlAutocomplete.ts:234` (`@typescript-eslint/no-explicit-any`)
- `src/components/query/QueryTab.tsx:598` (`react-hooks/exhaustive-deps`)
- `src/components/rdb/DataGrid.tsx:115` (`react-hooks/exhaustive-deps`)
- `src/components/datagrid/DataGridTable.tsx:552` (`react-hooks/exhaustive-deps`)
- `src/components/rdb/FilterBar.tsx:105` (`react-hooks/exhaustive-deps`)
- `src/components/schema/DocumentDatabaseTree.tsx:325` (`react-hooks/exhaustive-deps`)
- `src/components/document/AddDocumentModal.tsx:222` (`react-hooks/exhaustive-deps`)
- `src/components/document/DocumentFilterBar.tsx:488` (`react-hooks/exhaustive-deps`)

---

## 부록 C) 프로덕션 `console.*` 목록(테스트 제외, 주석 포함)

- `src/pages/HomePage.tsx:149`
- `src/pages/WorkspacePage.tsx:65`
- `src/main.tsx:53`
- `src/main.tsx:85`
- `src/lib/window-controls.ts:44`
- `src/lib/window-controls.ts:168`
- `src/AppRouter.tsx:99`
- `src/lib/window-lifecycle-boot.ts:52`
- `src/hooks/useSchemaCache.ts:30`
- `src/lib/perf/bootInstrumentation.ts:187`
- `src/components/shared/ErrorBoundary.tsx:28`
- `src/components/schema/DocumentDatabaseTree.tsx:227`
- `src/components/schema/SchemaTree.tsx:677`
- `src/components/schema/SchemaTree.tsx:737`

---

## 부록 D) 프로덕션 `as unknown as` 목록

- `src/lib/mongo/mongoAutocomplete.ts:246`
- `src/lib/mongo/mongoAutocomplete.ts:328`

