# Sprint 88: 공통 테스트 인프라 (Foundation)

**Source**: `docs/ui-evaluation-results.md` 공통 테스트 인프라 6 항목
**Depends on**: —
**Verification Profile**: command

## Goal

이후 sprint 들이 회귀-방지 테스트를 통일된 방식으로 작성할 수 있도록, 프론트/백엔드 공유 fixture 로딩, DOM 노드 불변 헬퍼, regression-first `.fails` 테스트 패턴, catch-block 감사 도구 4가지를 사용 가능 상태로 만든다.

## Acceptance Criteria

1. `tests/fixtures/` 디렉토리가 존재하고 최소 1개 샘플 JSON 파일 (`fk_reference_samples.json`) 이 들어있다. 동일 파일이 TS 테스트(`vitest`) 와 Rust 테스트(`cargo test`) 양쪽에서 로드 가능 — TS 측은 `import` 또는 `readFileSync`, Rust 측은 `include_str!` 로 접근.
2. `src/__tests__/utils/expectNodeStable.ts` 헬퍼가 등록돼 있고, 같은 selector 가 동일한 DOM 노드 identity (`===`) 를 유지하는지 단언하는 API 를 제공. 자기 검증 테스트 (`expectNodeStable.test.ts`) 가 통과한다.
3. `.claude/rules/test-scenarios.md` 에 "try-await 함수는 reject 케이스 테스트 필수" 체크리스트 항목이 추가되고, `try`/`catch` 가 비어 있는 함수를 코드베이스에서 찾아내는 정적 감사 결과(목록 파일)가 `docs/sprints/sprint-88/catch-audit.md` 로 산출된다.
4. Regression-first 패턴이 1개 예시 (`DataGridTable.parseFkReference.test.ts` 의 "현재 출력은 null 을 반환한다" 회귀 증명 테스트) 로 시연돼 있고, `.fails` 또는 `// TODO regression` 주석으로 의도적으로 통과/실패 상태가 명시돼 있다.
5. `pnpm test` 와 `cargo test` 가 둘 다 0 errors 로 통과한다.

## Components to Create/Modify

- `tests/fixtures/`: 신규 디렉토리. 프론트/백엔드 공유 샘플 입력 보관소.
- `tests/fixtures/fk_reference_samples.json`: schema/table/column 입력 + 기대 직렬화 문자열 페어 (#FK-1 와 sprint 89 가 함께 소비).
- `src/__tests__/utils/expectNodeStable.ts`: DOM identity 단언 헬퍼.
- `src/__tests__/utils/expectNodeStable.test.ts`: 헬퍼 자기 검증.
- `.claude/rules/test-scenarios.md`: catch-block 감사 체크리스트 항목 추가.
- `docs/sprints/sprint-88/catch-audit.md`: 비어 있거나 의심스러운 catch 블록 전수 감사 결과.
