# Sprint Execution Brief: sprint-88

## Objective

- 이후 sprint 들이 회귀-방지 테스트를 통일된 방식으로 작성할 수 있도록, 프론트/백엔드 공유 fixture 로딩, DOM 노드 불변 헬퍼, regression-first `.fails` 테스트 패턴, catch-block 감사 도구 4가지를 사용 가능 상태로 만든다.

## Task Why

- 이후 31개 sprint 가 이 인프라에 의존. 공유 fixture 와 regression-first 패턴이 없으면 sprint-89 (#FK-1) 부터 양방향 검증 불가.

## Scope Boundary

- 수정 허용 경로: `src/`, `src-tauri/`, `tests/fixtures/`, `.claude/rules/test-scenarios.md`, `docs/sprints/sprint-88/catch-audit.md`.
- 그 외 영역 (다른 sprint 영역, `CLAUDE.md`, `memory/`, `docs/sprints/sprint-88/spec.md`) 수정 금지.
- 다른 sprint 가 책임지는 실제 수정 (예: FK 파서 export = sprint-89) 건드리지 말 것.

## Invariants

- 기존 `pnpm test` 의 현재 passing 테스트는 모두 그대로 통과 (회귀 0).
- 기존 `cargo test` 결과 회귀 0.
- `CLAUDE.md` 수정 금지.
- `memory/` 트리 수정 금지.
- 기존 sprint spec (`docs/sprints/sprint-88/spec.md`) 수정 금지.

## Done Criteria

1. `AC-01`: `tests/fixtures/` 디렉토리 존재 + `fk_reference_samples.json` 샘플 1개 이상. 동일 파일이 TS 테스트(`vitest`) 와 Rust 테스트(`cargo test`) 양쪽에서 로드 가능 — TS 는 `import` 또는 `readFileSync`, Rust 는 `include_str!`.
2. `AC-02`: `src/__tests__/utils/expectNodeStable.ts` 헬퍼 등록 + 같은 selector 가 동일한 DOM 노드 identity (`===`) 를 유지하는지 단언하는 API 제공. 자기 검증 테스트 (`expectNodeStable.test.ts`) 통과.
3. `AC-03`: `.claude/rules/test-scenarios.md` 에 "try-await 함수는 reject 케이스 테스트 필수" 체크리스트 항목 추가 + `try`/`catch` 비어있는 함수 정적 감사 결과가 `docs/sprints/sprint-88/catch-audit.md` 로 산출.
4. `AC-04`: Regression-first 패턴 1개 예시 (`DataGridTable.parseFkReference.test.ts` 의 "현재 출력은 null 을 반환한다" 회귀 증명 테스트) 시연. `.fails` 또는 `// TODO regression` 주석으로 의도 명시.
5. `AC-05`: `pnpm test` 와 `cargo test` 가 둘 다 0 errors 로 통과.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run --reporter=default` — 0 errors.
  2. `pnpm tsc --noEmit` — 0 errors.
  3. `pnpm lint` — 0 errors.
  4. `cd src-tauri && cargo test` — 0 errors.
  5. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — 0 errors.
  6. `test -f docs/sprints/sprint-88/catch-audit.md` — exit 0.
  7. Fixture 파일 (`tests/fixtures/fk_reference_samples.json`) 존재 + TS 측 로드 테스트 1개 + Rust 측 `include_str!` 로드 테스트 1개 (총 1쌍) 통과 확인.
- Required evidence:
  - changed files 목록 + 각 파일의 목적 (fixture/helper/audit/regression test/rule update).
  - 위 7개 명령 출력 요약 (pass/fail + 핵심 라인 인용).
  - regression-first 예시 파일 경로 + `.fails` 또는 `// TODO regression` 주석 라인 인용.
  - catch-audit 통계 (감사된 파일 수, 비어있는 catch 블록 수, 의심 케이스 수).

## Evidence To Return

- Changed files 목록 + 각 파일의 목적 (fixture/helper/audit/regression test/rule update).
- 7개 Required Checks 명령 각각의 출력 요약 (fail/pass + 핵심 라인).
- Regression-first 예시 파일 경로 (`src/.../DataGridTable.parseFkReference.test.ts`) + `.fails` 또는 `// TODO regression` 주석 라인 인용.
- catch-audit 통계 (감사된 파일 수, 비어있는 catch 블록 수, 의심 케이스 수).
- 5개 acceptance criteria 각각에 대응하는 구체 증거 (파일/명령 결과).
- Assumptions made during implementation.
- Residual risk or verification gaps.

## References

- Contract: `docs/sprints/sprint-88/contract.md`
- Master plan: `docs/ui-fixes-plan.md`
- Spec: `docs/sprints/sprint-88/spec.md`
