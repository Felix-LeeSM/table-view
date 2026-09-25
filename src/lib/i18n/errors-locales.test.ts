import { DRIVER_ERROR_CATEGORIES } from "@lib/errors/driverErrorHints";
import { describe, expect, it } from "vitest";
import i18n from "./index";

// Purpose: two guards that lock en/ko locale drift.
//   1) The errors-ns keys derived from classifyDriverError exist in both en
//      and ko and resolve to real text (issue #1056, #1227).
//   2) Across all namespaces, the flatten(en) key set == the flatten(ko) key
//      set (issue #1582). #1604 translated the remaining English as en+ko
//      pairs, so the base must show zero drift.
//
// Location: keep this file **outside** `locales/` — see the
// `import.meta.glob` note in `src/lib/i18n/index.ts` (#1227).

/** Flattens nested resources to leaf path -> value; arrays count as leaves. */
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

/** Sorted list of the namespaces registered on the initialized instance. */
const namespaces = (
  Array.isArray(i18n.options.ns)
    ? i18n.options.ns
    : [i18n.options.ns ?? "common"]
)
  .filter((ns): ns is string => typeof ns === "string")
  .sort();

describe("errors namespace", () => {
  // Iterate the category SOT (the array derived from the union) as is — no
  // hard-coding. Adding a category makes this test demand en/ko text for the
  // new category automatically (#1227).
  const categories = DRIVER_ERROR_CATEGORIES;

  // Reason: adding a category without its text exposes the raw key to users.
  //         Requiring title+hint in both en and ko blocks incomplete text even
  //         before #1074 (2026-07-03).
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

// issue #1582: parity enforcement widened from the errors ns to all
// namespaces. A key added to or removed from only one locale exposes the raw
// key (or the fallback language) to users.
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

// Interpolation-variable parity (matching placeholder sets) is deliberately
// not enforced: en uses a `{{plural}}` variable for English plurals, as in
// `"{{total}} change{{plural}} pending"`, but Korean has no plural marker and
// omits it (query.pendingChanges.summary, query.resultGrid.rowsAffected).
// That is a legitimate per-language difference, not drift, so enforcing equal
// placeholder sets would produce false positives (#1582).
