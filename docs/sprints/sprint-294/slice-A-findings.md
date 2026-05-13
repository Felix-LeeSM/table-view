# Sprint 294 Slice A — Findings

## 결과: PASS

- 23 passed | 1 expected fail (vitest).
- tsc clean.
- sprint-292 무회귀.

## 핵심 발견

spec.md 의 가정 — `SELECT u.<cursor> FROM users u` 같은 alias dot prefix 가
lang-sql built-in 으로 안 풀린다 — 은 현재 버전 (`@codemirror/lang-sql` 최신
설치본) 에서 **틀렸다**. `getAliases` 가 statement 의 FROM/JOIN 절을 스캔해서
alias map 을 동기적으로 구축하므로 다음 6 시나리오가 모두 GREEN:

1. `SELECT u.<cursor> FROM users u`
2. `SELECT u.<cursor> FROM users u WHERE …`
3. `FROM users u JOIN orders o ON o.<cursor>`
4. `FROM users u JOIN orders o ON u.<cursor>`
5. `SELECT o.<cursor> FROM users u JOIN orders o ON …`
6. `SELECT u.<cursor>, o.… FROM users u JOIN orders o ON …`

즉 Sprint 292 PLAN.md 의 시나리오 (b) 가 동기 호출에서 실패했던 이유는
schema 형태 (`self`/`children` wrap) 때문이지 alias 추론 한계 때문이 아니
었다. Sprint 292 의 `sqlCompletionLevel1.test.ts` 에서 schema 를 평이한
형태로 바꾼 후엔 alias 도 같이 풀려 있었다.

## Slice B 의 진짜 표적

진짜 gap 은 **mid-typing flow** — 사용자가 `SELECT u.` 를 입력한 시점에서
아직 `FROM` 절을 안 적었을 때. lang-sql 은 alias 를 바인딩할 source 가
없어 0 후보. DataGrip / TablePlus 는 버퍼 어딘가의 `FROM <table> <alias>`
패턴을 찾아 alias 를 추론한다.

→ Slice B 의 `aliasColumnCompletionSource` 는 cursor 가 속한 Statement 가
완성되지 않았을 때 (FROM 없이 SELECT 만) buffer 전체에서 `FROM <table>
<alias>` 후보를 모아 alias map 을 구축한다. 또는 sprint-294 의 자체
mini-parser 가 항상 동기적으로 alias map 을 빌드하고 lang-sql 의 alias
map 과 합쳐 캐시한다.

## 잔여 위험

- 없음. Slice B 가 mid-typing flow 만 보강하면 6 spec 시나리오 + mid-typing
  까지 모두 GREEN. Slice C/D/E 는 그 위에서 wire + edge.
