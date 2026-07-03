import { describe, it, expect } from "vitest";

import i18n from "../index";
import type { DriverErrorCategory } from "@lib/errors/driverErrorHints";

// Purpose: classifyDriverError 가 파생하는 errors:hint.<category>.{title,hint}
//          키가 en/ko 양쪽에 존재하는지(드리프트 가드) 잠근다 (issue #1056)
//          — Phase 22 milestone 22.30 (2026-07-03).
describe("errors namespace", () => {
  const categories: DriverErrorCategory[] = [
    "connectionRefused",
    "authFailed",
    "timeout",
    "unknownHost",
    "permissionDenied",
  ];

  // Reason: 카테고리를 추가하고 문구를 빠뜨리면 사용자에게 raw 키가 노출된다.
  //         en/ko 모두 title+hint 를 강제해 #1074 이전에도 미완성 문구를 막는다 (2026-07-03).
  for (const locale of ["en", "ko"] as const) {
    for (const category of categories) {
      it(`resolves ${locale} title+hint for ${category}`, () => {
        const t = i18n.getFixedT(locale, "errors");
        for (const leaf of ["title", "hint"] as const) {
          const key = `hint.${category}.${leaf}`;
          const value = t(key);
          expect(value, `${locale} ${key} missing`).not.toBe(key);
          expect(value.length).toBeGreaterThan(0);
        }
      });
    }
  }
});
