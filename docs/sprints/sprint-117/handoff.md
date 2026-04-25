# Sprint 117 → next Handoff

## Sprint 117 Result

- **PASS** (Generator 직접 적용 + Evaluator 7.60/10, 1 attempt) — 1834/1834 tests, tsc/lint 0. 코드 변경 0, 신규 테스트 5 케이스만 추가.
- Evaluator follow-up 반영: (a) Case 3 빈 문자열 케이스 추가, (b) Case 3 의 `setTimeout(20)` → `waitFor(() => count === baseline)` 결정적 패턴 교체, (c) Case 2 의 userEvent 시도는 controlled number input 충돌로 fireEvent 회귀 + 사유 주석.

### Erratum

- contract / In Scope AC-04 / 본 handoff 에 "기존 19 개 DocumentDataGrid 테스트" 표기는 부정확. 실제는 **15 케이스** (`src/components/DocumentDataGrid.test.tsx`). 1829 → 1834 (+5) 델타는 정확. 미래에 동일 sprint 의 contract 를 인용할 때 이 erratum 을 참고.

## 산출물

- `src/components/DocumentDataGrid.pagination.test.tsx` (신규, 5 케이스):
  - **Case 1**: `renders First / Previous / Jump / Next / Last + Page size controls`. 6 개 aria-label 단언 (`First page`, `Previous page`, `Jump to page`, `Next page`, `Last page`, `Page size`).
  - **Case 2**: `Jump input dispatches a fetch with the correct skip when value is in range`. page=2 입력 → `findMock.calls.at(-1).body.skip === 300`.
  - **Case 3**: `Jump input ignores out-of-range values (no extra fetch)`. value=4/0/-1 입력 → `findMock` 호출 횟수 baseline 유지.
  - **Case 4**: `Last page button jumps to the final page`. click → `body.skip === 600` (totalPages=3, pageSize=300).
  - **Case 5**: `Page size uses the design-system Select (sprint 112 normalize)`. trigger.tagName=BUTTON, `document.querySelector("select")` null, click trigger → `role="option"` 4 개 (100/300/500/1000).
- `docs/sprints/sprint-117/{contract.md, execution-brief.md, handoff.md}`.

## AC Coverage

- AC-01 ✅ — Case 1 의 6 개 aria-label 단언이 First/Prev/Jump/Next/Last + size select trigger 마운트 증명.
- AC-02 ✅ — Case 2 (valid jump → skip=300) + Case 3 (invalid jump → 호출 늘지 않음) 가 jump 검증 정책 양면 커버.
- AC-03 ✅ — Case 5 가 (a) Radix Select trigger 가 BUTTON, (b) DOM 에 native `<select>` 부재, (c) trigger 클릭 시 `role="option"` 4 개 노출 — 3 단언으로 sprint 112 정규화 회귀 방지.
- AC-04 ✅ — 기존 19 개 DocumentDataGrid 테스트 변경 없음. 1829 → 1834 (+5) 모두 통과.
- AC-05 ✅ — `pnpm vitest run` 1834/1834, `pnpm tsc --noEmit` 0, `pnpm lint` 0.

## 검증 명령 결과

- `pnpm vitest run src/components/DocumentDataGrid.pagination.test.tsx` → 5/5 pass.
- `pnpm vitest run` → 108 files / **1834/1834** pass.
- `pnpm tsc --noEmit` → 0.
- `pnpm lint` → 0.

## 구현 노트

- DocumentDataGrid 는 sprint 87 에서 이미 `DataGridToolbar` 를 공유 마운트하도록 정렬되어 있었음 (`src/components/DocumentDataGrid.tsx:231` `<DataGridToolbar ...>`). sprint 112 의 size select Radix 정규화는 toolbar 내부에서 이루어졌으므로 자동 상속됨.
- 따라서 본 sprint 는 "정렬 사실의 회귀 방지" 가 본질 — 코드 변경 없이 테스트만 추가.
- `at(-1)` 메소드는 ES2022 lib 가 활성화되어야 사용 가능. 본 프로젝트의 tsconfig 가 ES2021 까지만 노출하므로 `arr[arr.length - 1]` 인덱스 접근으로 우회.

## 가정 / 리스크

- 가정: DocumentDataGrid 가 향후 다시 자체 toolbar 를 마운트하도록 분기되면 본 테스트가 즉시 실패해 회귀를 잡음 — 의도된 회귀 검출 메커니즘.
- 리스크 (낮음): `findMock` 호출 횟수 베이스라인 비교 (Case 3) 는 디바운스 / 비동기 fetch 가 늦게 도착할 경우 false negative 위험 — 20 ms sleep 으로 완화. 더 견고한 방법은 `findMock` 의 mock.calls.length 를 실시간으로 추적하는 별도 fixture 인데 현 sprint 범위에서는 과합.

## 회귀 0

- 코드 변경 0 (테스트만 추가). 기존 1829 테스트 전부 통과 + 신규 5 = 1834/1834.
