# Sprint 92 — Findings (Generator)

## Summary

ConnectionDialog 의 Test Connection alert 영역을 항시 마운트되는 단일 슬롯
(`data-slot="test-feedback"`) 으로 재구성하고, 기존의 `testing: boolean` +
`testResult: {success, message} | null` 두 state 조합을 단일
discriminated union (`idle | pending | success | error`) 으로 통합했다.
`min-h-[2.25rem]` 으로 idle/pending/success/error 모든 상태에서 같은 vertical
reserve 를 유지하며, sprint-88 의 `expectNodeStable` 헬퍼로 마운트/pending/
응답 후 DOM identity 가 유지됨을 단언한다. 연타 (3 회 클릭) 시에도
slot 노드 identity 가 보존됨을 별도 케이스로 고정.

## Changed Files

| Path | Purpose |
|---|---|
| `src/components/connection/ConnectionDialog.tsx` | `TestResultState` 4-state union 도입, `handleTest` pending 발행 → 응답 전이, alert 슬롯 항시 마운트 (`data-slot="test-feedback"` + `min-h`), pending 시 spinner + "Testing..." 노출. `error` (저장 실패) 알림은 별도 conditional block 으로 분리 (회귀 0). |
| `src/components/connection/ConnectionDialog.test.tsx` | sprint-92 describe 블록 추가 — `expectNodeStable` 단언 (마운트/pending/응답), 3 회 연타 race, pending 텍스트/스피너, idle → pending → success/error 4-state 전이 검증 (총 6 신규 테스트). |

## 4-State 전이 다이어그램 (텍스트)

```
                +----------------------+
                |  status: "idle"      |
                |  (placeholder, hidden)|
                +----------+-----------+
                           |
                  Test 버튼 click
                           v
                +----------------------+
                |  status: "pending"   |
                |  Loader2 + "Testing..." |
                +----+----------+------+
                     |          |
            success  |          |  error
        (resolve)    v          v   (reject)
        +-----------------+  +------------------+
        | status:"success"|  | status: "error"  |
        | message: <ok>   |  | message: <err>   |
        +--------+--------+  +--------+---------+
                 |                    |
                 |   Test 버튼 click  |
                 +-------+------------+
                         v
                +----------------------+
                |  status: "pending"   |
                |  (slot identity 유지) |
                +----------------------+
```

전이 규칙:
- `idle → pending` : Test 버튼 click 시 `setTestResult({status:"pending"})`.
- `pending → success` : `testConnection(...)` resolve.
- `pending → error` : `testConnection(...)` throw → `String(e)` message.
- `success | error → pending` : Test 버튼 재클릭. 슬롯은 unmount 되지 않는다.
- 슬롯 (`data-slot="test-feedback"`) 은 모든 state 에서 동일한 부모 `<div>` —
  내부 자식만 status 에 따라 교체된다.

## Verification Plan — Results

### 1. `pnpm vitest run`

```
 Test Files  90 passed (90)
      Tests  1654 passed (1654)
   Duration  15.92s
```

기존 1648 → 1654 (+6 신규 sprint-92 테스트). 0 failures. happy-path 회귀 0.

### 2. `pnpm tsc --noEmit`

Exit 0 (no output).

### 3. `pnpm lint`

Exit 0 (no output beyond pnpm header).

### 4. `grep -n 'data-slot="test-feedback"\|status:.*pending\|Testing' src/components/connection/ConnectionDialog.tsx`

```
47: * always mounted (see `data-slot="test-feedback"` below) and only its content
52:  | { status: "pending" }
109:    // "Testing..." while the request is in flight; the slot itself stays
111:    setTestResult({ status: "pending" });
570:          data-slot="test-feedback"
589:              <span>Testing...</span>
```

(slot attr · pending literal · "Testing..." text 모두 존재.)

### 5. `grep -n "expectNodeStable\|test-feedback\|pending\|Testing" src/components/connection/ConnectionDialog.test.tsx`

```
13:import { expectNodeStable } from "@/__tests__/utils/expectNodeStable";
856:  describe("Sprint 92: test-feedback slot stability + 4-state model", () => {
858:      document.querySelector('[data-slot="test-feedback"]') as HTMLElement;
870:    it("preserves slot DOM identity across idle → pending → success", async () => {
882:      const stable = expectNodeStable(getSlot);
889:      stable.assertStillSame("after pending");
890:      expect(screen.getByText("Testing...")).toBeInTheDocument();
904:    it("preserves slot DOM identity across idle → pending → error", async () => {
913:      const stable = expectNodeStable(getSlot);
918:      stable.assertStillSame("after pending");
... (총 28 라인 매칭, 6 개 신규 테스트 케이스)
```

## Acceptance Criteria — Evidence

### AC-01 — alert slot DOM identity (mount / pending / response)

- File: `src/components/connection/ConnectionDialog.tsx:569-572`

  ```tsx
  <div
    data-slot="test-feedback"
    className="border-t border-border px-4 py-3"
  >
  ```

- Test: `src/components/connection/ConnectionDialog.test.tsx:870-902`

  ```ts
  const stable = expectNodeStable(getSlot);
  // ...click → pending
  stable.assertStillSame("after pending");
  // ...resolve → success
  stable.assertStillSame("after success");
  ```

  마운트(`stable.initial` 캡처) → pending → success 세 시점 모두 동일 노드.

### AC-02 — 4-state discriminated union

- File: `src/components/connection/ConnectionDialog.tsx:50-54`

  ```ts
  type TestResultState =
    | { status: "idle" }
    | { status: "pending" }
    | { status: "success"; message: string }
    | { status: "error"; message: string };
  ```

- 사용처: `src/components/connection/ConnectionDialog.tsx:73-75, 111, 115, 117, 573, 582, 591, 596, 601`
- 기존 `testing: boolean` 은 `const testing = testResult.status === "pending"` 의
  derived 값으로 축소 (Footer Test 버튼 disabled/spinner 토글에만 사용).

### AC-03 — pending state: spinner + "Testing..." 텍스트

- File: `src/components/connection/ConnectionDialog.tsx:582-590`

  ```tsx
  ) : testResult.status === "pending" ? (
    <div role="status" aria-live="polite" className="...animate-in fade-in">
      <Loader2 className="size-4 animate-spin" />
      <span>Testing...</span>
    </div>
  ) : (
  ```

- Test: `src/components/connection/ConnectionDialog.test.tsx:994-1011`

  ```ts
  const slot = getSlot();
  const slotSpinner = slot.querySelector(".animate-spin");
  expect(slotSpinner).not.toBeNull();
  expect(slot.textContent).toContain("Testing...");
  ```

### AC-04 — 3 회 연타 시 slot DOM identity 유지

- Test: `src/components/connection/ConnectionDialog.test.tsx:931-991`

  ```ts
  const stable = expectNodeStable(getSlot);
  // click 1 → pending → success
  stable.assertStillSame("click 1 pending");
  stable.assertStillSame("click 1 success");
  // click 2 → pending → success
  stable.assertStillSame("click 2 pending");
  stable.assertStillSame("click 2 success");
  // click 3 → pending → success
  stable.assertStillSame("click 3 pending");
  stable.assertStillSame("click 3 success");
  ```

  3 회 클릭 × pending/success 2 시점 = 6 회 identity 단언, 모두 통과.
  (jsdom offsetHeight 한계로 spec 의 "높이 점프 0" 은 identity 단언으로 대체 —
  contract Verification Profile 의 명시된 결정.)

### AC-05 — happy-path 회귀 0

`pnpm vitest run` 전체 1654 / 1654 통과. 기존 ConnectionDialog 테스트 (1648 →
sprint-92 6 개 신규 추가 후 총 90 cases × 동일 file) 가 전부 그대로 통과.
주요 happy-path 보존 확인:

- `shows success result when test connection succeeds` — line 231-242 — pass
- `shows error result when test connection fails` — line 244-256 — pass
- `disables Test Connection button while testing` — line 258-273 — pass
- `marks Test result alert as aria-live='polite' for screen readers` — line 831-844 — pass

## 가정 / 결정 사항

1. **`error` (저장 실패) state 와 `testResult` 분리 유지**: spec/contract 의
   "testResult slot 과 error slot 을 합쳐도 OK" 조건을 따라가지 않고, 두
   slot 을 분리 유지했다. 이유:
   - `error` 는 form 저장 실패라는 다른 도메인이며 자체 pending 상태가 없다.
   - 분리하면 `error` 가 늘 conditional 이어도 testResult slot identity 가
     `error` 발생/해소와 무관하게 안정적이다 (단일 책임).
   - 기존 테스트의 `screen.getByRole("alert")` 가 검증 에러 (`Name is required`,
     `Save failed`, URL 에러) 케이스에서 단일 alert 만 매칭되도록 보장.
2. **idle slot 은 `aria-hidden` placeholder + `min-h-[2.25rem]`**: idle 상태의
   슬롯도 마운트되지만 시각적/스크린리더 noise 를 피하기 위해 `aria-hidden`.
   `min-h-[2.25rem]` 은 pending/success/error 모든 상태의 inner content 에도
   동일하게 부여해 dialog height jump 를 0 으로 reserve.
3. **`testing` derived flag 유지**: Footer Test 버튼의 `disabled` + spinner 는
   기존 동작을 그대로 유지 (`const testing = testResult.status === "pending"`).
   별도 useState 제거로 두 flag 가 어긋날 가능성 (sprint-92 spec 의 motivation)
   을 원천 차단.
4. **`role="status"` for pending vs `role="alert"` for success/error**: pending 은
   결과가 아니라 진행 상태이므로 `role="status"` 가 의미상 더 정확. 기존 test
   "marks Test result alert as aria-live='polite'" 는 success 도착 후 alert 를
   조회하므로 영향 없음.

## Residual Risk

- **jsdom offsetHeight 한계**: contract 가 명시한 대로 jsdom 은 `offsetHeight` 를
  의미있게 계산하지 못해 "높이 점프 0" 의 직접 측정은 불가능. DOM identity
  단언으로 대체했으며, 실 브라우저에서의 시각 회귀는 별도 사람 검증 또는
  Playwright e2e 으로 보강 필요. (sprint scope 외)
- **`min-h-[2.25rem]` 디자인 값**: alert 콘텐츠 (1줄) 의 평균 높이로 추정.
  메시지가 2 줄 이상이면 height 는 자연 증가하나, idle 상태의 reserve 는
  단일 라인 기준이라 한 줄 메시지에서 다중 라인 메시지로 전이될 때 일부
  jump 가능성 잔존. 디자인 sprint 에서 sweep 또는 `min-h` 대신
  `aspect-ratio` 기반 reserve 검토 가능.
- **`error` slot 별도 유지**: 저장 에러가 발생한 경우 footer 위에 별도 border
  bordered block 이 나타나 dialog 의 전체 높이는 점프한다. spec 의 핵심 P1
  관심사는 testResult slot 이므로 sprint scope 내에서는 의도된 trade-off.

## Generator Handoff

### Changed Files
- `src/components/connection/ConnectionDialog.tsx`: `TestResultState` 4-state union, alert slot 항시 마운트, pending spinner + "Testing..."
- `src/components/connection/ConnectionDialog.test.tsx`: sprint-92 describe 블록 (`expectNodeStable`, 3-click race, pending state, 4-state 전이)

### Checks Run
- `pnpm vitest run`: pass (1654/1654, +6 new sprint-92 tests)
- `pnpm tsc --noEmit`: pass (exit 0)
- `pnpm lint`: pass (exit 0)
- `grep 'data-slot="test-feedback"\|status:.*pending\|Testing' ConnectionDialog.tsx`: 6 라인 매칭
- `grep "expectNodeStable\|test-feedback\|pending\|Testing" ConnectionDialog.test.tsx`: 28 라인 매칭

### Done Criteria Coverage
- AC-01 (slot DOM identity 마운트/pending/응답): test `ConnectionDialog.test.tsx:870-902`
- AC-02 (4-state union): code `ConnectionDialog.tsx:50-54` + `:73-75, 111, 115, 117, 573, 582, 591`
- AC-03 (pending spinner + "Testing..."): code `:582-590`, test `:994-1011`
- AC-04 (3 회 연타 identity): test `:931-991`
- AC-05 (happy-path 회귀 0): `pnpm vitest run` 1654/1654 pass

### Assumptions
- `error` (form save error) 와 `testResult` slot 분리 유지 — 두 도메인의 책임이 다름.
- idle slot 은 `aria-hidden` placeholder + `min-h-[2.25rem]` 으로 reserve.
- jsdom 환경에서 `offsetHeight` 직접 측정 불가 — DOM identity 단언으로 대체 (contract 명시).

### Residual Risk
- jsdom 한계로 "높이 점프 0" 의 픽셀-정확 검증은 e2e (Playwright) 가 필요.
- 다중 라인 메시지 전이 시 `min-h-[2.25rem]` reserve 는 단일 라인 기준이라
  미세한 height 변화 가능 — 디자인 sprint 에서 sweep 권장.
- `error` (저장 실패) 알림은 여전히 conditional block — 저장 에러 발생 시
  dialog height 가 점프하지만 spec scope 외.
