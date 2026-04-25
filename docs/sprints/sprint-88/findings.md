# Sprint 88 Scorecard

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 9/10 | AC-01~05 모두 파일 단위 증거로 충족. fixture JSON 의 `expected` 필드는 모든 sample 에 대해 `<schema>.<table>(<column>)` 와 일치하고, TS/Rust 양쪽 로더가 동일 invariants(>=3 samples, boundary case 존재)를 assert. `expectNodeStable` 헬퍼는 capture 시점 falsy / 재호출 throw / 노드 교체 3가지 실패 모드 모두 명시적 메시지로 throw. catch-audit 은 placeholder 가 아닌 실제 파일/라인 단위 표 (TS 54 + Rust 3 = 57 케이스 분류). regression-first 테스트는 production regex 를 verbatim 복제 + `// TODO regression(sprint-89)` 인계 주석 포함. |
| Completeness | 9/10 | 5개 AC 모두 커버. AC-01 은 한 쌍 이상 (실제로 TS 3 테스트 + Rust 3 테스트). AC-02 자기 검증 테스트 4개 (요구된 ≥3 충족). AC-03 의 두 산출물(rule 추가 + audit 파일) 둘 다 실재. AC-04 는 happy-path/regression/boundary 3 케이스로 시연. AC-05 의 7개 required check 모두 green. catch-audit 의 follow-up 권장 섹션이 sprint-88 scope 를 명확히 분리해 후속 sprint 인계. |
| Scope Discipline | 8/10 | 허용 쓰기 경로 안에서만 작업. `git diff HEAD -- src/components/datagrid/DataGridTable.tsx src-tauri/src/db/postgres.rs CLAUDE.md docs/sprints/sprint-88/spec.md` 는 0 라인. 단, 워크트리에 pre-existing modifications (`memory/lessons/memory.md`, `src/components/connection/ConnectionDialog.tsx`) 이 남아있고 새 untracked lesson 디렉토리 (`memory/lessons/2026-04-25-multi-sprint-protected-scope-diff/`) 가 sprint-88 deliverable 생성(12:29) 보다 앞선 09:55 timestamp 로 존재 — Generator 가 직접 만든 게 아니라 orchestrator/planner 단계 산출물로 보이지만, contract 의 `memory/` 수정 금지 invariant 를 워크트리 레벨에서 100% 깨끗하게 보존하지는 못함. (점수 -2) |
| Evidence Quality | 9/10 | Generator evidence + orchestrator 독립 재실행 결과가 일치. Test Files 88 passed / Tests 1625 passed / cargo test green / clippy 0 warnings 모두 cross-check. fixture/helper/audit/regression 4개 인프라 각각 대응 파일과 라인 식별 가능. catch-audit 은 reproduction 명령(`rg --pcre2 -nP ...`)을 명시해 재감사 가능. |
| Sprint Hygiene | 9/10 | 후속 sprint 가 즉시 사용 가능한 인터페이스: `(1)` fixture JSON schema (`$schema: fk_reference_samples@1`, `samples[].{schema,table,column,expected}`), `(2)` `expectNodeStable<T>(getter): { initial, assertStillSame(label?) }` 한 줄 호출 API, `(3)` catch-audit 의 6단 분류(`handled`/`swallow-with-comment`/`swallow-no-comment`/`log-only`/`rethrow`/`mixed`)가 향후 audit 갱신 시 그대로 재사용. regression-first 테스트는 sprint-89 가 inline regex 복제본을 삭제하고 `import { parseFkReference }` 로 갈아끼우는 단일 단계 인계. |

**Overall**: 8.8/10
**Verdict**: PASS

## AC Verification

- **AC-01: PASS** — `tests/fixtures/fk_reference_samples.json` 존재, `$schema: "fk_reference_samples@1"`, 3개 sample (`happy_path_public_users_id`, `schema_with_underscore_orders_user_id`, `quoted_identifier_special_chars`). TS 측 `tests/fixtures/fk_reference_samples.test.ts` 가 `readFileSync` + `JSON.parse` 로 로드하여 (a) schema 버전 (b) ≥3 samples (c) boundary character 존재 3가지를 assert. Rust 측 `src-tauri/tests/fixture_loading.rs` 가 동일 파일을 `include_str!("../../tests/fixtures/fk_reference_samples.json")` + `serde_json::from_str` 로 로드하여 동일한 3 invariants 를 assert. 동일 파일·동일 invariants 양방향 증명.

- **AC-02: PASS** — `src/__tests__/utils/expectNodeStable.ts` 가 `expectNodeStable<T extends Node>(getter): NodeStableHandle<T>` 를 export 하고 handle 은 `assertStillSame(label?: string)` 메서드를 제공 (요구된 정확한 API 명). 자기 검증 `expectNodeStable.test.ts` 는 4 케이스 (요구된 ≥3 충족): (a) 동일 노드 → 통과, (b) 노드 교체 → `/DOM node identity changed/` + 라벨 포함 메시지로 throw, (c) 노드 사라짐 → `/unmounted/` 메시지로 throw, (d) capture 시점 falsy → `/falsy value at capture time/` 로 동기 throw. unmount 케이스 메시지가 "DOM node identity changed... element was unmounted/remounted (or replaced) instead of being updated in place. This typically breaks focus, IME composition, and animation continuity." 로 명확함.

- **AC-03: PASS** — `.claude/rules/test-scenarios.md` 19행에 정확한 문구 `**try-await 함수는 reject 케이스 테스트 필수**` 존재. 이어서 빈 catch / "에러 삼킴" 금지 + audit 등록 의무 명시. `docs/sprints/sprint-88/catch-audit.md` 는 placeholder 가 아닌 실제 표 (TS stores 16개 / TS components 25개 / TS lib 2개 / Rust 3개 = 약 57개 분류 행, 각각 `File | Line | Classification | Notes` 컬럼 포함). 통계 테이블에 `swallow-no-comment: 0`, `mixed: 5` 등 정량 결과 존재. Reproduction 명령까지 명시.

- **AC-04: PASS** — `src/components/datagrid/DataGridTable.parseFkReference.test.ts` 38-43행에 `it('returns null for the bare "<table>.<column>" form (CURRENT BUG)', () => { ... expect(parseFkReferenceCurrent("users.id")).toBeNull(); })` 로 "현재 출력은 null" 을 증명. 39행 `// TODO regression: sprint-89 must make this return a parsed object.` 주석 + 파일 헤더의 `TODO regression(sprint-89): once parseFkReference is exported, replace the inline copy ...` 가 sprint-89 인계 명시. 프로덕션 `src/components/datagrid/DataGridTable.tsx:39` 의 `function parseFkReference` 는 여전히 un-exported (확인됨), 즉 export 책임은 sprint-89 에 그대로 유지. inline regex (라인 32) 가 production regex (DataGridTable.tsx:42) 와 verbatim 일치.

- **AC-05: PASS** — orchestrator 독립 재실행 결과: `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0, `pnpm vitest run` Test Files 88 passed / Tests 1625 passed / 0 failures / 16.89s, `cd src-tauri && cargo test --quiet` all suites green (fixture_loading 3 passed 포함), `cargo clippy --all-targets --all-features -- -D warnings` 0 warnings. 7개 required check 전부 통과.

## Findings

- **F-1 (Low / Informational)**: 워크트리에 pre-existing modifications 가 남아있음 — `memory/lessons/memory.md` 에 `2026-04-25-multi-sprint-protected-scope-diff` 링크가 staged 되지 않은 상태로 추가돼 있고 동일 이름의 untracked 디렉토리가 존재. 파일 timestamp(09:55) 는 sprint-88 deliverable 생성(12:29) 보다 앞서므로 Generator 의 직접 변경이 아니라 orchestrator/planner 단계의 잔존물로 보임. Generator 가 명시적으로 `memory/` 를 건드렸다는 증거는 없고 contract 의 `memory/` 수정 금지 invariant 위반으로 직결되지는 않으나, orchestrator 가 다음 attempt 부터 sprint 시작 시 워크트리 baseline 을 `git status --porcelain` 로 캡처하고 종료 시 비교해서 Generator-attributable diff 만 측정하도록 하면 향후 동일 모호성을 제거할 수 있음.

- **F-2 (Low / Sprint Hygiene 권장)**: catch-audit 의 `mixed (5)` 케이스 (clipboard fallback / fire-and-forget prefetch / `let _ = app.emit(...)` 3건) 가 후속 sprint 로 인계되지만 owner 가 "roadmap during sprint-89+" 로 모호하게 지정. 향후 sprint planner 가 이를 구체적 sprint 번호로 매핑하지 않으면 영구적으로 방치될 위험. 현 sprint scope 안에서는 문제 없음 (audit 산출이 목적).

- **F-3 (Informational)**: `src/__tests__/utils/expectNodeStable.test.ts` 의 마지막 케이스가 `null as unknown as Element` 캐스트로 falsy 시뮬레이션을 함. 타입 안전성을 살짝 우회하지만 self-check 시나리오를 표현하는 가장 직접적인 방법이고 vitest 안에서만 평가되므로 production 영향 없음. 향후 헬퍼가 비-Element 노드 (예: Text) 를 지원해야 한다면 `T extends Node` generic 이 이미 그것을 허용하므로 추가 변경 불필요.

## Feedback for Generator
N/A (PASS).
