# Sprint 141 — Handoff (다음 sprint 142 로)

## 결과

- **Status**: PASS — 5/5 AC 충족, vitest/tsc/lint 모두 green.
- **다음 sprint baseline**: tooltip / placeholder 카피가 sprint 번호 / phase 번호 leak 없이 정리된 상태.

## sprint-142 가 의지하는 베이스라인

- `DbSwitcher.tsx` 는 이제 paradigm/연결 상태 인지 카피만 노출. sprint-148(Connection SoT + Disconnect) 에서 `isConnected` 토글이 들어오면 자동으로 새 카피로 갱신된다.
- 가드 테스트 `no-stale-sprint-tooltip.test.ts` 가 미래 sprint 의 placeholder 카피 회귀를 잡는다. 새 paradigm 이 들어와 placeholder 가 추가되어도 같은 패턴(`is planned but not yet …`)을 따르면 된다.

## sprint-142 시작 전 체크

- `e2e/feedback-2026-04-27.spec.ts` 안의 #8 (PG single-click preview) / #9 (dirty marker on dirty tab) 시나리오가 sprint-142 의 첫 red 테스트 후보다.
- `tabStore` 의 `lastViewedTabId` / preview tab semantic 을 다시 확인해야 한다 — preview 탭은 클릭 시 활성 preview 슬롯에 들어가고, double-click 또는 dirty 시 정식 탭으로 승격된다.

## 미결 / 다음에 얹을 것

- 가드 테스트는 src/ 트리만 본다. e2e/ 트리에 placeholder 가 들어가면 별도 가드 필요. 현재 e2e/ 에는 해당 카피 없음.
- 사용자 피드백 12건 중 #7(disabled tooltip) 만 닫혔다. #1 ~ #6, #8 ~ #12 는 sprint-142 ~ sprint-149 에 매핑됨 (`spec.md` 참조).
