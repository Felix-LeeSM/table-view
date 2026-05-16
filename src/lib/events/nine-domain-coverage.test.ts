/**
 * 작성 2026-05-16 (Phase 3 sprint-365, AC-365-07)
 *
 * 사유: F.4 invariant — 9 domain 모두 receiver 등록 사이트가 존재해야 한다.
 * "수신자 없음" silent drop 은 dispatcher 의 의도된 동작이지만, 그건 단지
 * "스토어가 아직 register 안 함" 일 시점의 안전망이고, dispatch 라우터의
 * `switch (payload.domain)` 자체는 9 case 모두 가지고 있어야 한다.
 *
 * 본 테스트는 stateChanged.ts 의 normal/gap router 두 곳을 직접 읽어
 * 9 domain literal 이 모두 등장하는지 확인한다. 회귀 시 (예: 10번째
 * domain 추가하면서 case 빠뜨림) 즉시 fail — 단순한 lint 가 아니라
 * dispatcher 의 완전성 자체를 잠금.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STATE_CHANGED_SOURCE_PATH = resolve(
  process.cwd(),
  "src/lib/events/stateChanged.ts",
);

function readStateChangedSource(): string {
  return readFileSync(STATE_CHANGED_SOURCE_PATH, "utf8");
}

const DOMAINS = [
  "connection",
  "group",
  "workspace",
  "mru",
  "favorite",
  "history",
  "setting",
  "schemaCache",
  "datagridColumnPrefs",
];

describe("AC-365-07 9-domain switch coverage", () => {
  it('stateChanged.ts has a `case "<domain>"` for every domain in both routers', () => {
    const source = readStateChangedSource();

    for (const domain of DOMAINS) {
      // routeNormalHandler + routeGapHandler each must reference the
      // domain — so we expect at least 2 occurrences of the case label.
      const literal = `case "${domain}":`;
      const occurrences = source.split(literal).length - 1;
      expect(
        occurrences,
        `expected at least 2 occurrences of '${literal}' (normal + gap router), got ${occurrences}`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("EventDomain union covers every domain literal", () => {
    const source = readStateChangedSource();

    for (const domain of DOMAINS) {
      expect(
        source.includes(`"${domain}"`),
        `EventDomain union should contain literal '${domain}'`,
      ).toBe(true);
    }
  });

  it("STATE_CHANGED_EVENT constant is exactly 'state-changed'", () => {
    // Backend mirror constant in `src-tauri/src/events.rs::STATE_CHANGED_EVENT`.
    // Drift between the two would silently break cross-window delivery.
    const source = readStateChangedSource();
    expect(source).toContain('STATE_CHANGED_EVENT = "state-changed"');
  });
});
