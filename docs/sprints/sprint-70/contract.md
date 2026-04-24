# Sprint Contract: sprint-70 (Phase 6 plan D-1 — BsonTreeViewer component + tests)

## Summary

- Goal: canonical extended JSON을 인식해 BSON 타입을 뱃지로 축약하고 중첩 document/array를 접기/펼치기로 탐색할 수 있는 **`BsonTreeViewer` 컴포넌트**를 완성한다. 경로/값 복사까지 포함한 재사용 가능한 read-only 트리 뷰어.
- Audience: Sprint 71에서 `QuickLookPanel`이 document 모드로 mount할 **준비물**. 이번 스프린트에서 뷰어 자체의 품질·테스트 커버리지를 확보해, 다음 스프린트에서는 연결 배선만 집중할 수 있게 한다.
- Owner: Sprint 70 generator agent.
- Verification Profile: `command` (cargo 회귀 + vitest 특정 파일 + tsc + lint 중심. 전체 vitest suite는 orchestrator가 돌림).

plan 상 "Sprint D"를 2개로 분할 — **Sprint 70** = 컴포넌트+테스트, **Sprint 71** = `QuickLookPanel` 통합 + `DocumentDataGrid` selection/이동. 번호 67~69 선점으로 원래 로드맵에서 +3씩 밀렸고, plan D의 범위가 단일 스프린트에 과적이라 한 번 더 쪼개 **plan D-1 / D-2**로 분리.

이전 Generator 시도에서 `src/components/shared/BsonTreeViewer.tsx`(450줄)가 이미 작성되어 있다. 이번 스프린트는 해당 파일을 **검증 → 필요 시 수정 → 테스트 보강**하는 것으로 시작한다.

## In Scope

- `src/components/shared/BsonTreeViewer.tsx`
  - 이미 작성된 450줄 파일을 읽어 contract와 일치하는지 감사.
  - 가감 필요 시 최소 수정으로 교정 (무분별 재작성 금지).
  - API 최종 확정: `{ value: Record<string, unknown> | null; rootLabel?: string; className?: string }` (optional props 추가 가능하나 기본 2~3개).
- `src/components/shared/BsonTreeViewer.test.tsx` (신규)
  - 최소 6개 테스트 (AC-01~AC-07 커버).

## Out of Scope

- `QuickLookPanel`의 `mode` prop 도입 및 document 렌더 분기 — Sprint 71.
- `DocumentDataGrid` row selection, 파일 이동, `isDocumentSentinel()` 헬퍼 교체 — Sprint 71.
- `MongoAdapter::find/aggregate` 실제 구현 — Sprint 72.
- 인라인 편집, 문서 추가/삭제, MQL Preview — Sprint 73.
- 트리 내 값 편집. 이번 뷰어는 **read-only**.
- BlobViewerDialog 통합.
- 대용량 문서 가상 스크롤.

## Invariants

- `QuickLookPanel`, `DataGrid`, `DocumentDataGrid` 등 **이번 스프린트에서 수정하지 않는 파일**은 diff 0.
- 기존 테스트 스위트 전 건 통과 유지(`QuickLookPanel.test.tsx`, `DocumentDataGrid.tsx` 관련 기존 테스트).
- cargo/rust 변경 없음.
- 기존 `src/types/document.ts` 의 `isDocumentSentinel`, `DOCUMENT_SENTINELS` 정의 및 shape 불변 (이번 스프린트에서 소비 안 함; 추가 유틸만 허용).
- 타입은 `interface` props 패턴, `React.memo` 남발 금지 (react-conventions 규칙).

## Acceptance Criteria

- `AC-01` `BsonTreeViewer`가 중첩 object/array를 재귀적으로 트리 노드(`role="tree"` / `role="treeitem"`)로 렌더. 기본적으로 root 노드는 펼침, depth ≥ 2는 접힘.
- `AC-02` 펼침/접힘이 마우스 + 키보드(Enter/Space)로 동작. 각 확장 가능한 노드에 `aria-expanded="true"|"false"` 반영.
- `AC-03` canonical extended JSON 래퍼는 whitelist 기반으로 scalar 뱃지로 축약. 최소 7종 테스트: `ObjectId`, `ISODate`, `NumberLong`, `NumberDouble`, `NumberInt`, `Decimal128`, `Binary`. 나머지(`Timestamp`, `RegExp`, `Symbol`, `Code`, `MinKey`, `MaxKey`, `Undefined`)는 코드에만 포함되면 충분.
- `AC-04` 일반 문서에서 `$`로 시작하지만 whitelist 밖인 키(`$comment` 등)는 뱃지로 오인하지 않고 object 노드로 렌더.
- `AC-05` 키 라벨 버튼 클릭 시 `navigator.clipboard.writeText`가 경로 문자열로 호출됨. 경로 포맷: 배열 인덱스는 `[i]`, 식별자형 키는 `.key`, 식별자가 아닌 키는 `["key"]`.
- `AC-06` 스칼라 노드의 "Copy value" 버튼 클릭 시 `navigator.clipboard.writeText`가 JSON-stringified 값으로 호출. 객체/배열 노드도 값 복사 버튼 제공 (`JSON.stringify(value, null, 2)`).
- `AC-07` `value === null`일 때 안전하게 빈 상태 메시지를 렌더(에러 없이).
- `AC-08` 빈 객체 `{}`, 빈 배열 `[]`, 5단계 이상 깊이 중첩 문서에서 에러 없이 렌더.
- `AC-09` Verification Plan 체크 5건 모두 통과.

## Design Bar / Quality Bar

- 노드 타이포그래피는 `.font-mono`, 들여쓰기는 depth당 12~16px.
- 뱃지 색상은 기존 `Badge` 컴포넌트 토큰 또는 Tailwind semantic 토큰 재사용.
- 라이트/다크 모드 `dark:` prefix로 대응.
- 신규 CSS/색상 변수 정의 금지.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --all -- --check`
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm vitest run src/components/shared/BsonTreeViewer.test.tsx`

**Orchestrator가 별도로 실행하는 체크 (generator 책임 아님)**:
- `cd src-tauri && cargo test --lib`
- `pnpm vitest run` (전체 suite 회귀 확인)

이 분리의 목적은 generator가 실행하는 단일 명령의 idle-timeout 위험을 낮추는 것. generator는 **변경 파일 범위에 한정**된 체크만 돌린다.

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록과 역할.
  - 5개 generator-scope check 실행 결과 (통과/실패 + 핵심 지표).
  - 각 AC에 대응하는 테스트 이름 + 파일 경로.
  - 뱃지 whitelist 판정 규칙 코드 위치.
- Evaluator must cite:
  - `BsonTreeViewer.test.tsx`의 9개 AC 커버 증거 (테스트명 인용).
  - 뱃지 whitelist 구현 위치.
  - orchestrator가 돌린 전체 회귀 결과(handoff에 인용되어야 함).

## Test Requirements

### Unit Tests (필수)
- AC-01 ~ AC-09 커버 최소 1개씩.
- 에러/예외: `value === null` 렌더, `$comment` 오인 방지.
- 경계: 빈 객체/배열, 5 depth 중첩.

### Coverage Target
- `BsonTreeViewer.tsx`: 라인 80% 이상.

### Scenario Tests (필수)
- [x] Happy path — 중첩 트리 렌더 + 기본 펼침/접힘.
- [x] 에러/예외 — `null` 입력, `$comment` whitelist 탈락.
- [x] 경계 — 빈 객체/배열, 깊은 중첩.
- [x] 기존 기능 회귀 없음 — `QuickLookPanel.test.tsx`가 수정되지 않았음을 git diff로 확인.

## Test Script / Repro Script

1. `pnpm vitest run src/components/shared/BsonTreeViewer.test.tsx`
2. `pnpm tsc --noEmit && pnpm lint`
3. `cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings`

## Ownership

- Generator: Sprint 70 harness generator.
- Write scope: `src/components/shared/BsonTreeViewer.tsx` (수정), `src/components/shared/BsonTreeViewer.test.tsx` (신규). 그 외 파일 diff 금지.
- Merge order: Sprint 71이 이 뷰어를 소비하므로, 이 스프린트 PASS 후에만 Sprint 71 착수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (5개 generator-scope 체크 + orchestrator가 돌리는 전체 회귀 2개)
- Acceptance criteria evidence linked in `handoff.md`
