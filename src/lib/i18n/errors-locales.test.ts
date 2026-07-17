import { describe, it, expect } from "vitest";

import i18n from "./index";
import { DRIVER_ERROR_CATEGORIES } from "@lib/errors/driverErrorHints";

// Purpose: en/ko 로케일 드리프트를 잠그는 두 가드를 둔다.
//   1) errors ns 의 classifyDriverError 파생 키가 en/ko 양쪽에 존재하고
//      실제 문구로 resolve 되는지 (issue #1056, #1227).
//   2) 전 네임스페이스에서 flatten(en) 키 집합 == flatten(ko) 키 집합 (issue #1582).
//      #1604 가 en+ko 쌍으로 잔여 영문을 번역해 base 는 drift 0 이어야 한다.
//
// 위치 주의: 이 파일은 `locales/` **밖**에 둔다. `index.ts` 의
// `import.meta.glob("./locales/*.ts")` 는 파일명=네임스페이스 계약이라
// locales/ 안의 test 파일까지 네임스페이스로 import 해 앱 부팅/빌드를 깬다 (#1227).

/** 중첩 리소스를 leaf path -> value 로 평탄화한다. 배열은 leaf 로 취급. */
function flattenLeaves(obj: unknown, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj == null || typeof obj !== "object") return out;
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flattenLeaves(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

/** init 된 인스턴스에서 등록된 네임스페이스 목록을 정렬해 얻는다. */
const namespaces = (
  Array.isArray(i18n.options.ns)
    ? i18n.options.ns
    : [i18n.options.ns ?? "common"]
)
  .filter((ns): ns is string => typeof ns === "string")
  .sort();

describe("errors namespace", () => {
  // 카테고리 SOT(union 파생 배열)에서 그대로 순회 — 하드코딩 없음. 카테고리를
  // 추가하면 이 테스트가 자동으로 새 카테고리의 en/ko 문구를 요구한다 (#1227).
  const categories = DRIVER_ERROR_CATEGORIES;

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

// issue #1582: parity 강제를 errors ns 한정에서 전 네임스페이스로 확대. 한쪽
// 로케일에만 키가 추가/삭제되면 사용자에게 raw 키(또는 fallback 언어)가 노출된다.
describe("en/ko key parity (all namespaces)", () => {
  for (const ns of namespaces) {
    it(`en and ko expose identical keys for "${ns}"`, () => {
      const enKeys = new Set(
        Object.keys(flattenLeaves(i18n.getResourceBundle("en", ns))),
      );
      const koKeys = new Set(
        Object.keys(flattenLeaves(i18n.getResourceBundle("ko", ns))),
      );
      const missingInKo = [...enKeys].filter((k) => !koKeys.has(k)).sort();
      const missingInEn = [...koKeys].filter((k) => !enKeys.has(k)).sort();
      expect(
        { missingInKo, missingInEn },
        `i18n key drift in "${ns}" — missing in ko: [${missingInKo.join(
          ", ",
        )}]; missing in en: [${missingInEn.join(", ")}]`,
      ).toEqual({ missingInKo: [], missingInEn: [] });
    });
  }
});

// 보간 변수 parity(placeholder 집합 일치)는 의도적으로 두지 않는다: en 은
// `"{{total}} change{{plural}} pending"` 처럼 영어 복수화용 `{{plural}}` 변수를
// 쓰지만 한국어는 복수 표지가 없어 이를 생략한다(query.pendingChanges.summary,
// query.resultGrid.rowsAffected). 이는 드리프트가 아니라 언어별 정당한 차이라
// placeholder 집합 동일성을 강제하면 false positive 가 된다 (#1582).
