---
title: 비-E2E 테스트 시나리오 설계 원칙 (Rust unit/integration · React component · Zustand store · Hook · Async)
type: memory
updated: 2026-07-17
---

# 비-E2E 테스트 시나리오 설계 원칙

E2E 외 모든 테스트(`*.test.{ts,tsx}`, Rust `#[cfg(test)]`, `src-tauri/tests/`)
를 새로 작성·수정하기 전에 이 방을 읽는다.
자동 로드: `.claude/rules/testing.md` 가 이 방을 가리킨다.

E2E 원칙([e2e-scenarios](../e2e-scenarios/memory.md))과 같은 P-시리즈
번호를 사용해 레이어 간 일관성을 유지한다 — 같은 P 번호는 같은 의도다.

기존 메커니즘 룰(`*.rs` 명명, `mockall`, RTL 쿼리 등)은 [conventions](../memory.md)
와 `.claude/rules/testing.md`가 권위. 이 방은 *어떤 시나리오를 만들 것인가*
의 원칙만 정제한다.

---

## 9 가지 원칙

### P1. 레이어 분리 — 가장 낮은 레이어로 잡힐 수 있는 사실은 거기에 둔다
- unit → component → integration → e2e 순으로 점검.
- store action 동작은 store test, DOM 라벨/role은 component test, 두 컴포넌트가
  동일 store 통해 통신할 때만 integration, 윈도우+IPC가 살아 있어야 보일 때만
  e2e (그 e2e는 `e2e-scenarios` 의 P1).
- 같은 사실을 두 레이어에 적으면 *드리프트*가 발생한다.

### P2. 사용자 가시 행동 검증, 구현 세부 회피
- RTL: `getByRole` > `getByLabelText` > `getByText` > `findBy*` > `getByTestId`(최후).
- Rust: trait contract / 공개 API 검증. private 함수에 매달리면 리팩터링이 곧
  테스트 깨짐으로 이어진다 (그건 P8 신호가 아니라 잘못된 결합).
- 컴포넌트 prop 검증보다 *사용자가 화면에서 본 결과*를 검증.

### P3. 테스트 격리 — state 누수 금지
- Zustand store는 매 테스트 `useStore.setState(initial, /*replace*/ true)` 로 reset.
- Rust 모듈은 fresh setup. mock은 매 테스트 reset (`vi.clearAllMocks()` /
  `mockall` per-test 인스턴스).
- 테스트 순서가 결과를 바꾸면 결함. CI는 `--shuffle` 로 가끔 검증.

### P4. 에러 분기 동등 비중
- `try-await` 가 throw 했을 때, `Result::Err` 가 반환됐을 때, 빈/누락 입력일 때를
  happy path와 *동등한 무게*로 다룬다.
- `catch` 블록 자체가 테스트 대상이다. 빈 `catch {}` 추가 시 sprint-88 catch
  audit 룰 적용 (사유 코멘트 + 회복 액션을 테스트로 고정).

### P5. race / async 결정론화
- stale 응답 덮어쓰기, abort/cancel, timeout은 `vi.useFakeTimers()` / mockall
  `Sequence` / `tokio::time::pause` 로 명시 검증.
- "가끔 빠르면 통과" 식 flake 의존 금지. 결정론화하지 못하면 그 시나리오는
  *상위 레이어*에서 검증해야 한다는 신호 (P1).

### P6. mock은 boundary에만
- mock 대상: DB, 네트워크, 파일시스템, OS 호출, Tauri command (frontend 시점).
- 금지: 같은 crate / 같은 src 트리 안 *내부* 모듈 mocking — 강결합 신호.
- 내부 mocking이 필요해 보인다면 (a) 인터페이스 추상화 부재 (b) 모듈 책임 과다
  중 하나. 테스트 대신 *코드 구조*를 손본다.

### P7. 테스트 = 스펙. 작성 이유 + 날짜 코멘트
- 모든 테스트 파일/블록에 작성 이유와 날짜 (사용자 명시 2026-04-28).
- 이름은 `it("does X when Y")` / `test_<fn>_<scenario>_<expected>`.
- 코드 리뷰 시 "이 테스트가 왜 있는지"를 코멘트만 보고 알 수 있어야 한다.

**형식**:
- `describe` 블록 상단: `// Purpose: <파일/스코프 전체 목적> — Phase NN sprint <N> (YYYY-MM-DD)`
- `test` / `it` 블록 상단: `// Reason: <이 테스트 작성 이유> (YYYY-MM-DD)`
- 버그 회귀 테스트: 버그 보고 출처(사용자 보고 / 이슈 번호 / sprint number) 명시.

```typescript
// Purpose: connection activation lifecycle 회귀 진단 — Phase 13 sprint 156 (2026-04-28)
describe('ConnectionActivation', () => {
  // Reason: 사용자 보고 — connection 더블클릭해도 workspace 미열림 (2026-04-28)
  it('double-click triggers showWindow → focusWindow → hideWindow chain', () => {
    // ...
  });
});
```

**Why**: 향후 요구사항 변경이나 리팩토링으로 테스트가 상충할 때, 해당 테스트가 언제/왜 작성되었는지 알아야 폐기·수정 여부를 판단할 수 있다.

### P8. 테스트 깨지면 production 먼저 의심
- timeout 늘리기 / `expect` 약화 / `skip` 추가는 *진짜 회귀를 가린다*.
- 깨진 사실은 신호. 무시하기 전에 (a) production 변경이 의도였는가 (b) 테스트
  자체가 P2를 위반해 구현 세부에 결합됐는가 둘 중 어느 쪽인지 판정.
- 테스트 약화로 결정해야 할 때는 PR 본문에 사유와 그 테스트가 다음에 어떻게
  복원될지 적는다.

### P9. 무의미 테스트 금지 — 테스트는 프로덕션 코드를 실행하고, *실패할 수 있어야* 한다
테스트는 "프로덕션 코드가 깨졌을 때 fail" 할 때만 자리값을 한다. 아래 냄새는
새 커버리지 0 이면서 리팩터에 취약하므로 *삭제하거나 behavioral 로 재작성*한다
(2026-07-17 전면 테스트 감사에서 반복 검출; 일반론: change-detector /
tautological / assertion-roulette, testsmells.org).

- **자기 재단언(tautology)**: 테스트가 만든 fixture·mock 반환·passthrough
  wrapper·`JSON.parse`/serde 왕복을 그대로 재단언. 프로덕션 함수를 호출하지
  않으면 무의미. (P2·P6)
- **항상 참 / 무단언**: `expect(true).toBe(true)`, 이미 dedup 된 배열의
  `new Set(x).size===x.length`, 단조증가 count `>=`, "no crash" 무단언 —
  최소 하나의 *실패 가능한* 단언을 둔다.
- **소스/표현 결합(change-detector)**: `readFileSync`+문자열 grep, CSS util
  class(`toHaveClass("px-3")`)·아이콘 class(`svg.lucide-*`)·DOM 위치
  (`nth-child`) 단언. 사용자 가시 결과(role/aria/텍스트/동작)로 대체. (P2 강화)
- **타입 재단언(type-only-at-runtime)**: 컴파일러가 이미 보장하는 사실
  (`Record<K>` 키 존재, union 리터럴 개수, `as T` 캐스트 후 필드 확인)을 런타임
  재확인. 런타임 guard/parser/변환을 *실제 실행*할 때만 유지.
- **라이브러리 재검증(framework)**: serde derive roundtrip, `#[default]`,
  `twMerge`/`clsx`, Radix/shadcn primitive 동작 — 우리 코드가 라이브러리를
  *어떻게 쓰는지의 계약*만 검증한다.
- **약한 중복(subset)**: 더 강한 단언에 포함되는 약한 subset 은 제거. 입력/방언
  만 다른 반복은 table-driven(`it.each` / `for (input,expected)`) 하나로. (P1 강화)

**단, 지울지 애매하면 KEEP**: 표면상 중복이라도 *다른 프로덕션 코드경로*
(예: AST 경로 vs regex fallback)거나 *cross-boundary SOT 미러*(FE↔Rust fixture
parity, redact/injection allowlist)면 유지 — 삭제 시 계약이 조용히 깨진다.

**정리 규율(cleanup = refactor)**: 무의미 테스트 제거는 리팩터로 다룬다 —
(a) 제거 라인이 다른 테스트로 이미 커버되어 coverage ratchet
(`docs/quality/coverage-ratchet.md`)이 유지되는지 확인(중립 제거), (b) 배치마다
suite green, (c) 보안·데이터무결성 테스트(redact/injection/escape/crypto)는
절대 얇게 만들지 않는다(P8), (d) 완전성/불변식 가드는 삭제가 아니라 behavioral
재작성으로 대체(예: source-grep 라우팅 완전성 → 각 domain dispatch 실행 검증).

---

## 레이어별 부록

### Rust unit / integration
- 단위: 같은 파일 하단 `#[cfg(test)] mod tests {}`. 통합: `src-tauri/tests/`.
- 분기 매트릭스는 table-driven: `for (input, expected) in &[...] { ... }`.
- `mockall` for trait, `#[tokio::test]` for async, `assert_matches!` for `Result::Err`.
- 커버리지: frontend 전역 gate 는 `vite.config.ts` 와
  `docs/quality/coverage-ratchet.md` 의 statements 85 / lines 87 / functions 87 /
  branches 78. Rust local target 은 sprint/contract 에 adapter/parser/command
  위험도 기준으로 명시한다.

### React component (vitest + RTL)
- `userEvent` > `fireEvent` — 실제 키보드/포커스 시퀀스를 시뮬레이션.
- async UI: `findBy*` 또는 `waitFor`. 직접 `act` 호출은 거의 필요 없다.
- 한 it에서 *한 가지 사용자 의도*만 검증 (e2e P2와 같은 정신, 더 작은 단위).

### Zustand store
- 매 테스트 reset (P3).
- 시나리오 단위: action chain (a → b → c) 흐름 검증. 단일 action만 검증하면
  P1으로 강등 가능성을 점검 (그건 그냥 함수 테스트일 수도).
- persist된 store는 `localStorage` mock 으로 격리, persist key 충돌 주의.

### Hook
- `renderHook` + `act` (테스트 라이브러리가 필요한 경우만 명시 호출).
- hook 자체가 아닌 *hook이 일으키는 부수효과* (state set, callback 호출, ref
  변동, side-effect cleanup) 를 검증.

### Integration (Rust `src-tauri/tests/`)
- 실 DB가 필요한 시나리오는 docker compose `test` profile (sprint-169 결과물).
- mock DB 는 *contract* 검증 전용 — 실 DB 대용으로 쓰지 않는다 (sprint-169 이전
  프로젝트가 빠진 함정).
- DBMS / adapter / result envelope 지원 범위 주장은
  [fixtures](fixtures/memory.md) 의 local fixture / conformance 증거와 함께 둔다.

---

## 새 테스트 추가 전 체크리스트

- [ ] 가장 낮은 레이어로 잡히는가? (P1)
- [ ] role / text / contract 로 쿼리했는가? (P2)
- [ ] beforeEach / fresh setup / mock reset 있는가? (P3)
- [ ] error 분기도 검증했는가? 빈/누락 입력은? (P4)
- [ ] 비동기 race를 fake timer / Sequence 로 결정론화했는가? (P5)
- [ ] mock이 internal 모듈을 가리지 않는가? (P6)
- [ ] 작성 이유 + 날짜 코멘트 있는가? (P7)
- [ ] 깨진 테스트를 약화시키지 않았는가? (P8)
- [ ] 프로덕션 코드가 깨지면 이 테스트가 fail 하는가? tautology/source-grep/type-only/framework/subset 아닌가? (P9)

---

## 관련 방

- [conventions](../memory.md) — Rust/TS/테스트 메커니즘 룰
- [e2e-scenarios](../e2e-scenarios/memory.md) — 같은 P-시리즈, e2e 레이어
- [fixtures](fixtures/memory.md) — fixture strategy / support claim evidence
- [docs/archives/decisions](../../../../docs/archives/decisions/memory.md) — historical ADR archive
- 자동 로드: `.claude/rules/testing.md` (전역 paths)
