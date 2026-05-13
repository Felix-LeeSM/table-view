# Sprint 294 Slice D — Findings

## 결과: PASS

- 5 edge it 모두 GREEN.
- `parseFromContext` 가 schema-qualified target (`public.users`) 을 dotted
  single tableName 으로 coalesce 하도록 보강.
- 전체 vitest 3320 passed.

## 보강 내역

`src/lib/completion/shared.ts` — `parseFromContext` 의 table-introducer
walker 가 `[identifier, '.', identifier, …]` 시퀀스를 단일 dotted tableName
으로 합치고, 그 다음 토큰부터 alias 슬롯을 읽는다. 기존 callers
(`completion/sqlite.ts`, `completion/pg.ts`, `completion/mysql.ts`) 가
받는 `FromContext.tables[]` 도 같은 형태로 강화 — bare + qualified 둘 다
가 namespace 키로 등장하는 sprint-268 Policy A 와 호환.

## 동일 alias 중복 정책

`aliases[aliasName] = tableName` 의 last-wins. `FROM users u, orders u` →
`u` 가 `orders` 로 바인딩. 사용자가 의도한 alias 가 무엇이든 둘 다 자주
참조될 수 있어서, 후보 중복 없이 한쪽 셋만 노출하는 게 popup UX 에 깔끔.
정책은 코드 코멘트로 명시.

## 잔여 위험

없음. Slice E 의 dedup 단언만 남음.
