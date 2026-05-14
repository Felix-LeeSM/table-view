---
id: 0029
title: mongosh expression parser — handwritten whitelist (WASM sidecar 미채택)
status: Accepted
date: 2026-05-14
---

**결정**: Phase 28 Slice A1 의 mongosh expression parser 는 `src/lib/mongo/mongoshParser.ts` 안에 자체 구현한 **pure-TS hand-written whitelist parser** 로 둔다. mongosh LSP / WASM sidecar (Q14 option 2+ 의 "preferred" 안) 는 채택하지 않는다.

**이유**:

1. **R28.1 의 cost-tradeoff** — Phase 28 grill (Q14) 은 "WASM/sidecar 가 가능하다면 우선하되, 번들 / 빌드 부담이 과하면 handwritten whitelist 로 fallback" 으로 frozen. mongosh REPL 의 공식 parser (`@mongosh/shell-api`, `@mongosh/i18n`) 는 transitive 의존성이 100+ 개이며 WASM 으로 패키징해도 출력 크기가 200 KB 이상이 되는 것이 일반적이다 (mongosh CLI 의 npm pack 결과 ≈30 MB). Tauri 앱은 desktop 단일 사용자 모델이라 코드 splitting / lazy-load 의 이득이 거의 없어 추가 200 KB+ 가 cold-boot 비용으로 그대로 합산된다.
2. **Surface 가 좁다** — 우리가 수용하는 method 는 13 개, BSON literal 은 6 개. mongosh 의 전체 expression 문법은 임의의 JS 가 허용되지만, ADR 0005 / 0006 / 0022 의 보안 정책상 우리는 그 표면 전부를 결코 dispatch 하지 않는다. Whitelist parser 의 acceptance 영역이 곧 dispatch surface 와 일치하므로 grammar 사이즈 ≈ 30 productions 으로 닫힌다 — sqlx parser / mongosh full grammar 와 비교해 작은 수준.
3. **No JS eval 인변 유지** — handwritten parser 는 `eval` / `new Function` / `Function(...)` 을 호출할 표면 자체가 없다. ADR 0006 (raw query 편집은 queryAnalyzer gate 통과 시만) 의 일관 — parser 가 dispatch 보다 strict 한 acceptance set 을 갖는다는 보장을 token-level 로 증명 가능 (grep-able: `grep -E "\b(eval|new Function)\b" src/lib/mongo/mongoshParser.ts` = empty).
4. **Test coverage 90% 목표 도달 가능** — `.claude/rules/testing.md` 의 "쿼리 파서/빌더 90%" 기준은 작은 grammar 에서 한 파일로 직접 도달 (96.44% line, Sprint 307 측정치). WASM sidecar 였다면 boundary (TS→WASM serialize) 가 자체 brittle 테스트 표면을 추가했을 것이다.

**트레이드오프**:

- **+** 번들 크기 ≈8 KB (gzipped). cold-boot 영향 무시 가능. Sprint 175 cold-boot baseline (1404ms) 에 회귀 risk 없음.
- **+** 빌드 의존성 0 — `pnpm install` 시 추가 패키지 없음. dependabot / RUSTSEC 추적 표면도 늘지 않음.
- **+** parser 의 grammar 가 명시적으로 `MONGOSH_METHOD_WHITELIST` (13) + `CURSOR_CHAIN_METHODS` (4) + `BSON_LITERAL_NAMES` (6) 의 union 으로 닫혀 있어 spec audit / threat-model 검토가 줄단위 가능.
- **−** mongosh 가 새 method 를 추가하거나 BSON literal 을 확장하면 우리도 코드를 수정해야 한다 (WASM 이었다면 upstream version bump 한 줄). 실측 cost: MongoDB 7.x → 8.x 사이 추가된 driver method 는 0 개, BSON literal 도 0 개 — Phase 28 의 frozen set 이 안정적이다.
- **−** mongosh 의 일부 표면 (예: `db.coll.find().pretty()`, `printjson(...)`) 은 우리 grammar 가 거부한다. 사용자가 mongosh REPL 에서 복사한 표현식이 항상 통과하지는 않음을 in-app 메시지로 안내 필요 (Sprint A3 의 editor banner).
- **−** parser 의 acceptance 가 실제로 backend dispatch 와 일치하는지는 별도 회귀 보호가 필요 — Sprint A5 의 dispatch matrix RTL 테스트가 이 invariant 를 잠근다.

**관련**:

- Phase 28 grill: [phase-28-mongo-full-support](../../roadmap/phase-28-mongo-full-support/memory.md) Q14, R28.1
- Sprint 307 contract: [`docs/sprints/sprint-307/contract.md`](../../../docs/sprints/sprint-307/contract.md)
- ADR 0006 (queryAnalyzer gate 일관성)
- ADR 0022 (Safe Mode — destructive 만 confirm)
