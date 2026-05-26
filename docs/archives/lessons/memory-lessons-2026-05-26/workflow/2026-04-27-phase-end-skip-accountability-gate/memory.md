---
title: Phase 종료 시 skip된 테스트는 "0건이거나, 메모리에 등록됐거나, skip 메시지에 컨텍스트가 박혀 있거나" 셋 중 하나여야 한다
type: lesson
date: 2026-04-27
---

**상황**: Phase 11 마무리에서 RISK-023로 e2e #8 preview tab 3건을 `this.skip()` 처리했는데, 단순 skip이면 다음 phase가 그 갭을 모르고 지나칠 수 있고 deferred 작업이 영구히 잊힐 위험이 있다.
**원인**: skip은 회귀 게이트를 통과시키는 가장 조용한 도구라서, 컨텍스트 없이 남겨두면 "초록 CI"로 위장된 채 무한 이월된다 — 본 phase에서는 ADR/RISK/findings 4중 잠금이 있었지만 e2e skip 자체에는 식별자가 없어 grep으로 추적 불가능했다.
**재발 방지**: phase 종료 게이트에 "skip 검증" 단계를 추가한다 — 모든 `it.skip` / `this.skip()` / `it.todo` / `xit` 는 (a) 그 phase에서 제거됐거나, (b) `RISK-NNN` 또는 ADR 식별자가 박힌 deferred 메모리에 등록됐거나, (c) skip 직전 주석/title에 `[DEFERRED-<ID>]` + 동치 커버리지 경로(unit/integration 파일명) + 재진입 트리거를 담는다. 셋 중 어느 것도 아니면 phase 종료 불가. `grep -rE "skip|todo" e2e/ src/**/*.test.*` 결과를 phase findings에 첨부해 강제한다.
