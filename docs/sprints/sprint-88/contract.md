# Sprint Contract: sprint-88

## Summary

- Goal: 이후 sprint 들이 회귀-방지 테스트를 통일된 방식으로 작성할 수 있도록, 프론트/백엔드 공유 fixture 로딩, DOM 노드 불변 헬퍼, regression-first `.fails` 테스트 패턴, catch-block 감사 도구 4가지를 사용 가능 상태로 만든다.
- Audience: sprint-89 이후 모든 sprint 의 Generator/Evaluator.
- Owner: harness Generator (sprint-88).
- Verification Profile: `command`

## In Scope

- `tests/fixtures/` 디렉토리 신규 생성 + `fk_reference_samples.json` 샘플 fixture 작성 (프론트/백엔드 공유).
- `src/__tests__/utils/expectNodeStable.ts` 헬퍼 + `expectNodeStable.test.ts` 자기 검증.
- `.claude/rules/test-scenarios.md` 에 try-await/catch-block 감사 체크리스트 항목 추가.
- `docs/sprints/sprint-88/catch-audit.md` 정적 감사 산출물 생성 (비어있거나 의심스러운 catch 블록 전수 목록).
- Regression-first 패턴 1개 시연: `DataGridTable.parseFkReference.test.ts` 의 "현재 출력은 null 을 반환한다" 회귀 증명 테스트 (`.fails` 또는 `// TODO regression` 명시).
- TS 측 fixture 로드 테스트 1개 + Rust 측 `include_str!` 로드 테스트 1개 (양방향 가용성 증명).

## Out of Scope

- 실제 FK 파서 수정/export (sprint-89 `#FK-1` 책임).
- `parseFkReference` 의 정상 동작 구현 (이번 sprint 는 회귀 증명 테스트만 추가; 통과 구현은 sprint-89 에서).
- catch-audit 결과에 따른 catch 블록 수정 (감사 결과 산출만 — 실제 fix 는 후속 sprint).
- DOM 안정화 헬퍼를 사용하는 실제 컴포넌트 리팩터 (sprint-89 이후).
- 공통 인프라가 아닌 임의 영역의 추가 테스트.

## Invariants

- 기존 `pnpm test` 의 현재 passing 테스트는 모두 그대로 통과 (회귀 0).
- 기존 `cargo test` 결과 회귀 0.
- `CLAUDE.md` 수정 금지.
- `memory/` 트리 수정 금지.
- 기존 sprint spec (`docs/sprints/sprint-88/spec.md`) 수정 금지.

## Acceptance Criteria

- `AC-01`: `tests/fixtures/` 디렉토리 존재 + `fk_reference_samples.json` 샘플 1개 이상. 동일 파일이 TS 테스트(`vitest`) 와 Rust 테스트(`cargo test`) 양쪽에서 로드 가능 — TS 는 `import` 또는 `readFileSync`, Rust 는 `include_str!`.
- `AC-02`: `src/__tests__/utils/expectNodeStable.ts` 헬퍼 등록 + 같은 selector 가 동일한 DOM 노드 identity (`===`) 를 유지하는지 단언하는 API 제공. 자기 검증 테스트 (`expectNodeStable.test.ts`) 통과.
- `AC-03`: `.claude/rules/test-scenarios.md` 에 "try-await 함수는 reject 케이스 테스트 필수" 체크리스트 항목 추가 + `try`/`catch` 비어있는 함수 정적 감사 결과가 `docs/sprints/sprint-88/catch-audit.md` 로 산출.
- `AC-04`: Regression-first 패턴 1개 예시 (`DataGridTable.parseFkReference.test.ts` 의 "현재 출력은 null 을 반환한다" 회귀 증명 테스트) 시연. `.fails` 또는 `// TODO regression` 주석으로 의도 명시.
- `AC-05`: `pnpm test` 와 `cargo test` 가 둘 다 0 errors 로 통과.

## Design Bar / Quality Bar

- 헬퍼 API 는 호출부에서 한 줄로 사용 가능 (selector, 두 시점 비교).
- Fixture JSON 은 입력/기대 출력 페어 구조로, sprint-89 에서 추가 수정 없이 재사용 가능.
- Regression-first 테스트는 "현재 동작" 을 명시적 주석으로 문서화하여 후속 sprint 에서 반전 시점이 명확.
- catch-audit 산출물은 파일/라인/함수명 단위로 식별 가능한 표 형태.

## Verification Plan

### Required Checks

1. `pnpm vitest run --reporter=default` — 0 errors.
2. `pnpm tsc --noEmit` — 0 errors.
3. `pnpm lint` — 0 errors.
4. `cd src-tauri && cargo test` — 0 errors.
5. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — 0 errors.
6. `test -f docs/sprints/sprint-88/catch-audit.md` — exit 0.
7. Fixture 파일 (`tests/fixtures/fk_reference_samples.json`) 존재 + TS 측 로드 테스트 1개 + Rust 측 `include_str!` 로드 테스트 1개 (총 1쌍) 통과 확인.

### Required Evidence

- Generator must provide:
  - changed files 목록 + 각 파일의 목적 (fixture/helper/audit/regression test/rule update).
  - 위 7개 명령 출력 요약 (pass/fail + 핵심 라인 인용).
  - regression-first 예시 파일 경로 (`src/.../DataGridTable.parseFkReference.test.ts`) + `.fails` 또는 `// TODO regression` 주석 라인 인용.
  - catch-audit 통계 (감사된 파일 수, 비어있는 catch 블록 수, 의심 케이스 수).
  - acceptance criteria 5개 각각에 대응하는 구체 증거.
- Evaluator must cite:
  - 각 AC 별 파일 경로 + 명령 결과.
  - missing/weak evidence 는 finding 으로 명시.

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목에 대응하는 최소 1개 테스트 작성.
- 에러/예외 케이스 최소 1개 테스트 작성 (예: 헬퍼에 동일하지 않은 노드를 넣었을 때 fail 단언).

### Coverage Target
- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)
- [ ] Happy path: fixture 로드 성공 / 헬퍼가 같은 노드 identity 통과.
- [ ] 에러/예외 상황: 헬퍼가 다른 노드 identity 에 대해 단언 실패.
- [ ] 경계 조건: fixture 가 빈 배열/특수문자 케이스 포함.
- [ ] 기존 기능 회귀 없음: `pnpm test` / `cargo test` 결과 회귀 0.

## Test Script / Repro Script

1. `pnpm vitest run --reporter=default`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. `cd src-tauri && cargo test`
5. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
6. `test -f docs/sprints/sprint-88/catch-audit.md && test -f tests/fixtures/fk_reference_samples.json`
7. Regression-first 테스트 파일 존재 + `.fails`/`// TODO regression` 주석 grep 확인.

## Ownership

- Generator: harness Generator (sprint-88).
- Write scope: `src/__tests__/utils/`, `tests/fixtures/`, `src-tauri/tests/` (또는 inline 테스트), `.claude/rules/test-scenarios.md`, `docs/sprints/sprint-88/catch-audit.md`, sprint-88 회귀 증명 테스트 파일.
- Merge order: sprint-88 → sprint-89 (#FK-1) → 후속.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
