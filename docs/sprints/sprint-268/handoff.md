# Sprint 268 Handoff — Autocomplete cache schema-qualification (intra-DB collision fix)

## Status

Complete. `useSqlAutocomplete` 의 column-lookup 캐시를 schema-identity 보존
형태로 재구성하여 동일 `(connId, db)` 의 두 schema 가 같은 table 이름을
가질 때 발생하던 last-writer-wins 충돌을 제거. 4개 신규 AC 케이스 중
**AC-268-02 만이 실제로 `a3f7efc` 사전-fix 에서 실패**하던 case (bare-key
overwrite); AC-268-01 / AC-268-03 / AC-268-04 는 기존 baseline 에서도 이미
통과하던 동작을 **regression pin** 으로 동결. Generator 가 ambiguity policy
A (union dedup) 를 선택, in-code comment + vitest 로 pinning. Sprint 264
cross-DB isolation case 와 Sprint 233 fully-quoted PG/SQLite case 는
byte-equivalent 로 통과.

## Acceptance Criteria — verification

| AC | 결과 |
|---|---|
| AC-268-01 qualified lookup schema-correct | ✅ `src/hooks/useSqlAutocomplete.test.ts:980` — `ns["public.users"]` = `{id, name}`, `ns["auth.users"]` = `{id, login_ip}`. Baseline 에서도 통과 (regression pin) |
| AC-268-02 bare-key Policy A (union dedup) | ✅ `src/hooks/useSqlAutocomplete.test.ts:1061` — `ns.users` = `{id, name, login_ip}` (length 3). Policy A 코드 코멘트 `src/hooks/useSqlAutocomplete.ts:208-215` (sprint id + date + rationale + 거부된 Policy B 명시). 사전-fix 에서 실패하던 유일한 case |
| AC-268-03 single-schema parity | ✅ `src/hooks/useSqlAutocomplete.test.ts:1139` — `ns.users` / `ns["public.users"]` 모두 `{id, name}`. `unionColumns` 가 single-candidate short-circuit (`useSqlAutocomplete.ts:353`) |
| AC-268-04 fully-quoted PG path | ✅ `src/hooks/useSqlAutocomplete.test.ts:1192` — `ns['"public"."users"'].children` = `{id, name}`, `ns['"auth"."users"'].children` = `{id, login_ip}`. Sprint 233 alias path 가 per-iteration schema-correct `colNs` 를 그대로 소비 |
| AC-268-05 회귀 가드 | ✅ per-file 35/35 (was 31, +4 monotonic), 전체 suite 3205/3205 (was 3201, +4), `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0 |

## 주요 production 변경

| 파일 | 변경 |
|---|---|
| `src/hooks/useSqlAutocomplete.ts` | `cachedColumnsByName` 을 `byQualified: Record<"schema.table", colNs>` + `byBareName: Record<bare, colNs[]>` 두 map 으로 분리 (L196-206). Policy A inline comment + sprint id (L208-215). `pickBareColumns` helper (L216-232). Tables / views 의 bare-key 등록을 loop 후로 defer 하여 views 가 tables 와 union 되지 않도록 보존 (L300-342). Post-loop `unionColumns` 로 candidate set 을 dedup 후 등록 (L344-367) |
| `src/hooks/useSqlAutocomplete.test.ts` | Sprint 268 section header + 작성 이유 / date / policy choice (L965-976). AC-268-01 ~ AC-268-04 4 신규 case |

## 테스트

### Frontend (vitest) — 4 신규 케이스

- `src/hooks/useSqlAutocomplete.test.ts:980` — AC-268-01 schema-qualified
  lookup 이 intra-DB collision 하에서 schema-correct columns 반환. positive
  + negative property assertion.
- `src/hooks/useSqlAutocomplete.test.ts:1061` — AC-268-02 bare-key 가 Policy
  A (union dedup) 를 따름. `ns.users` 에 `id`, `name`, `login_ip` 모두
  존재 + `Object.keys` length === 3.
- `src/hooks/useSqlAutocomplete.test.ts:1139` — AC-268-03 single-schema 일
  때 bare / qualified 둘 다 `{id, name}` 만 노출 (length 2).
- `src/hooks/useSqlAutocomplete.test.ts:1192` — AC-268-04 PG dialect mount
  + intra-DB collision 에서 `ns['"public"."users"']` 와
  `ns['"auth"."users"']` 가 schema-correct.

Backend `cargo test` 변경 없음 (in-scope 가 frontend hook 한정).

## Out of Scope

contract.md §Out of Scope 와 동일:

1. **Sprint 269 (DbMismatch toast Retry button)** — 본 sprint 에서 toast
   plumbing 미변경.
2. **Sprint 270 (cold-boot skeleton placeholders)** — perceived performance
   별 sprint.
3. **Sprint 271 (`expected_database` 가드 propagation)** — 나머지 RDB
   introspection / DDL command 별 sprint.
4. **`schemaStore` shape 변경 없음** — Sprint 263 이후 `(connId, db, schema,
   table)`-keyed 그대로 유지. Hook 의 내부 캐시만 재구성.

## Lessons

- **"Fix" 라고 선언하기 전에 baseline audit** — Generator 가 신규 4개 AC
  중 실제로 `a3f7efc` 에서 fail 하던 것은 AC-268-02 하나뿐임을 확인. 나머지
  3개는 regression pin 으로 자리매김. 신규 test 를 추가할 때 parent commit
  에 대해 한 번 돌려보고 "fail-pre-fix vs regression-pin" 을 명시적으로
  분류하면 spec wording / handoff 가 honest 해짐.
- **Policy A vs Policy B — deterministic choice 가 contract 의 ambiguity
  를 죽인다** — bare-key 충돌을 "한 가지 정책으로 고정" (union dedup) 하고
  in-code comment + test 로 pinning 하면 향후 refactor 가 무의식 중에
  policy 를 뒤집는 일을 방지. Generator 의 rationale: "silently dropping a
  column candidate is a worse failure mode than offering a superset; the
  user can always schema-qualify to narrow."
- **Planner-side note — spec wording 정밀화** — master spec 의 AC-268-01
  문구 ("the new test must FAIL on `a3f7efc`") 는 사실 bare-key overwrite
  (AC-268-02) 를 묘사하면서 qualified-key assertion 으로 작성됨. 다음
  planning cycle 에서는 "must-fail-pre-fix" 와 "regression pin" 을 AC
  단위로 구분해서 표기하는 게 evaluator 검증에 매끄러움.
