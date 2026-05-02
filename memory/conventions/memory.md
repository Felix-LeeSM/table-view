---
title: 코딩 컨벤션
type: memory
updated: 2026-04-22
---

# 코딩 컨벤션

Rust / TypeScript / 테스트 / 커밋 / 금지 사항. 작업 전 훑어볼 것.

## Rust

- `cargo fmt` 포맷, `cargo clippy` 린트 필수 통과.
- 에러: `thiserror`로 `AppError` 정의, `Result<T, AppError>` 반환. `unwrap()` 금지 (테스트 제외) — `?` 또는 `map_err` 사용.
- 공개 API는 `///` 문서 주석.
- 모듈: `mod.rs`에서 공개 인터페이스 노출, 파일 1개 = 주요 struct/trait 1개, 순환 참조 금지.
- DB 드라이버는 `DbAdapter` trait 구현 (async), Connection Factory 패턴으로 인스턴스 생성.
- `DbAdapter` 핵심 메서드: `connect`, `disconnect`, `execute`, `query`, `get_tables`, `get_schema`.

## TypeScript / React

- 함수 컴포넌트만 (class 금지). 파일명 PascalCase, 1파일=1컴포넌트. Props는 `interface` + `export`.
- 전역 상태는 Zustand 스토어(`src/stores/`, camelCase). 지역 상태는 `useState`/`useReducer`. 서버 상태는 필요 시 TanStack Query.
- Tailwind 유틸리티 클래스 우선, 커스텀 CSS 최소화, 다크 모드 지원 필수.
- `any` 금지 — 모르는 타입은 `unknown` + 타입 가드로 좁힘. strict mode 필수.

## 테스트

- 신규 기능/버그 수정은 테스트 동반 필수 (테스트 없는 커밋 금지).
- Rust: 같은 파일 하단 `#[cfg(test)] mod tests {}` 또는 `src-tauri/tests/` 통합 테스트. 핵심 로직(DbAdapter 구현체, 쿼리 파서) 커버리지 80% 이상.
- React: Vitest + React Testing Library. 파일은 컴포넌트 옆 `*.test.tsx` 또는 `__tests__/`. Zustand 스토어는 순수 함수처럼.
- E2E: WebdriverIO + tauri-driver 로 핵심 플로우(연결 생성, 쿼리 실행, 결과 확인). 시나리오 설계 원칙은 [e2e-scenarios](e2e-scenarios/memory.md) 필독.
- 시나리오 원칙: 비-E2E 는 [testing-scenarios](testing-scenarios/memory.md), E2E 는 [e2e-scenarios](e2e-scenarios/memory.md). 같은 P-시리즈로 일관.
- 커버리지 기준 (CI 검증): 전체 라인 40% / 함수 40% / 브랜치 35%. 신규·수정 파일 라인 70% 권장.
- 시나리오 체크: happy path, 빈/누락 입력, 에러 복구, 동시성(빠른 더블 클릭 등), 상태 전이. 상세: `.claude/rules/test-scenarios.md`.
- 변경 후 필수 검증: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`.

## 리팩토링 코드 표준

[refactoring](./refactoring/memory.md) sub-room — 4 카테고리
(B store coupling / D lib·hook 경계 / C hook API shape / A 분해 경계).
Sprint 189–198 의 모든 refactor / feature 커밋은 본 표준의 규칙을 따른다.

본 표준은 영속. Sprint 189–198 의 시한부 sequencing / smell 카탈로그는
2026-05-02 Sprint 198 종료로 retire — 결정 / 결과는 각 sprint 의
`docs/sprints/sprint-189` ~ `sprint-198` handoff 가 source of truth.

## 금지 사항

- `unwrap()` 남용 (Rust 테스트 제외).
- `any` (TypeScript).
- 민감 정보(비밀번호, API 키) 하드코딩.
- `console.log` 디버깅 코드 커밋.
- 직접 DOM 조작 (`document.querySelector` 등).
- 테스트 없는 새 기능 커밋.
- `eval()`, `innerHTML` (XSS 위험).

## 커밋 메시지 (Conventional Commits)

형식: `type(scope): description`

타입: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

예:
- `feat(connection): add connection test button`
- `fix(query): handle empty result set`
- `refactor(db): extract common adapter logic`
- `test(connection): add unit tests for PostgreSQL adapter`

## 스프린트 문서 네이밍

- `docs/sprints/`는 **오직 `sprint-N/`(정수 번호)** 만 사용. 알파벳 suffix(A1/A2/B 등)나 다른 네이밍 스킴 금지.
- Phase 내부 플랜이 A1/A2/B~F처럼 부속 ID를 가져도 프로젝트 sprint 번호는 전역 순차 번호로 매핑한다. 본문에서 플랜 섹션 ID를 병기하고 싶으면 `Sprint 63 (Phase 6 plan A1)` 형태로 표기.
- `/harness` 등으로 스프린트 번호 `N`이 지정되지 않으면 `docs/sprints/`의 다음 미사용 정수 번호를 사용한다.

## 관련 방

- [architecture](../architecture/memory.md) — 모듈 구조
- [decisions](../decisions/memory.md) — 컨벤션을 만든 결정들
- [e2e-scenarios](e2e-scenarios/memory.md) — E2E 시나리오 설계 8원칙 + CUJ 5종
- [testing-scenarios](testing-scenarios/memory.md) — 비-E2E 시나리오 설계 8원칙 (unit/component/store/integration/async)
