# Sprint 331 Contract — Slice DB-Scope.4 (ADR closure)

날짜: 2026-05-15

## Scope

Sprint 328~330 의 Mongo DB-scope 변경 (toolbar chip 제거 / tab-local chip
/ sidebar 우클릭) 을 영구 ADR 로 동결한다.

## Done Criteria

1. `memory/decisions/0030-mongo-db-scope-tab-local/memory.md` — ADR 0030
   생성 (Accepted, 2026-05-15).
2. `memory/decisions/memory.md` — 인덱스 +1 row (ADR 0030), `updated`
   필드 갱신.
3. backend dead code 제거는 본 sprint 의 scope **외** — `resolved_db_name`
   이 여전히 `active_db` 필드를 fallback 처리에 사용하므로 진짜 dead 아님.
   ADR 의 트레이드오프 섹션에 명시.

## Out of Scope

- backend `MongoAdapter::switch_active_db` 제거 (dead 가 아님).
- D-72 backend 라인업 (list_indexes, collMod, …) — Sprint 332 부터 진행.
  +3 shift 된 일정.

## Invariants

- 기존 ADR 0001~0029 본문 무수정 (작성 시점 동결 정책).

## Verification Plan

- Profile: `static`
- Required checks:
  1. `memory/decisions/0030-mongo-db-scope-tab-local/memory.md` 존재.
  2. `memory/decisions/memory.md` 인덱스 row 추가.
- Required evidence:
  - 파일 경로.
