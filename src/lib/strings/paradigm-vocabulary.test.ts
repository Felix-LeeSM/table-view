// Reason: Sprint 179 (AC-179-01 / AC-179-04) introduces the typed paradigm
// vocabulary dictionary. These tests anchor (a) every Paradigm key gets a
// complete entry across the seven required vocabulary keys, (b) the rdb
// entry equals the legacy English copy already asserted by the existing
// component tests so Sprint 179 doesn't regress them, and (c) the
// `getParadigmVocabulary(undefined)` fallback returns the rdb entry.
// Date: 2026-04-30.
import { describe, it, expect } from "vitest";
import type { Paradigm } from "@/types/connection";
import {
  PARADIGM_VOCABULARY,
  getParadigmVocabulary,
  type ParadigmVocabulary,
} from "./paradigm-vocabulary";

const ALL_PARADIGMS: Paradigm[] = ["rdb", "document", "search", "kv"];
const REQUIRED_KEYS = [
  "unit",
  "units",
  "record",
  "records",
  "container",
  "addUnit",
  "emptyUnits",
] as const satisfies ReadonlyArray<keyof ParadigmVocabulary>;

describe("paradigm-vocabulary dictionary", () => {
  // Reason: AC-179-01a — assert every Paradigm key has a complete entry
  // across the seven required vocabulary keys. Iterates 4×7=28 cells.
  // Date: 2026-04-30.
  it("[AC-179-01a] every Paradigm has a complete vocabulary entry", () => {
    for (const paradigm of ALL_PARADIGMS) {
      const entry = PARADIGM_VOCABULARY[paradigm];
      expect(entry, `paradigm "${paradigm}" entry`).toBeDefined();
      for (const key of REQUIRED_KEYS) {
        const value = entry[key];
        expect(typeof value, `paradigm.${paradigm}.${key}`).toBe("string");
        expect(
          value.length,
          `paradigm.${paradigm}.${key} non-empty`,
        ).toBeGreaterThan(0);
      }
    }
  });

  // Reason: AC-179-01b — sanity that no entry is filled with placeholders
  // along the unit/record/container axis. Catches typos like every key
  // being "Field". Date: 2026-04-30.
  it("[AC-179-01b] each entry has distinct unit/record/container strings", () => {
    for (const paradigm of ALL_PARADIGMS) {
      const entry = PARADIGM_VOCABULARY[paradigm];
      expect(entry.unit, `paradigm.${paradigm}.unit !== record`).not.toBe(
        entry.record,
      );
      expect(
        entry.record,
        `paradigm.${paradigm}.record !== container`,
      ).not.toBe(entry.container);
    }
  });

  // Reason: AC-179-01c — anchor the RDB entry equals the legacy English
  // copy. The existing component tests assert these literal strings, so a
  // future drift here would silently break them. Date: 2026-04-30.
  it("[AC-179-01c] rdb entry matches the legacy English copy", () => {
    expect(PARADIGM_VOCABULARY.rdb).toEqual({
      unit: "Column",
      units: "Columns",
      record: "Row",
      records: "Rows",
      container: "Table",
      addUnit: "Add Column",
      emptyUnits: "No columns found",
    });
  });

  // Reason: AC-179-01d — anchor the document entry's Mongo vocabulary so
  // AC-179-02 component tests can rely on the same source of truth.
  // Date: 2026-04-30.
  it("[AC-179-01d] document entry contains the Mongo vocabulary", () => {
    const doc = PARADIGM_VOCABULARY.document;
    expect(doc.unit).toBe("Field");
    expect(doc.units).toBe("Fields");
    expect(doc.record).toBe("Document");
    expect(doc.records).toBe("Documents");
    expect(doc.container).toBe("Collection");
    expect(doc.addUnit).toBe("Add Field");
    expect(doc.emptyUnits).toBe("No fields found");
  });
});

describe("getParadigmVocabulary", () => {
  // Reason: AC-179-04a — the fallback rule lives in exactly one place
  // (this getter) and `undefined` resolves to the rdb entry. This is the
  // dictionary-level fence; the component-level fence is asserted in
  // StructurePanel.test.tsx and ColumnsEditor.test.tsx. Date: 2026-04-30.
  it("[AC-179-04a] getParadigmVocabulary(undefined) returns the rdb entry", () => {
    expect(getParadigmVocabulary(undefined)).toEqual(PARADIGM_VOCABULARY.rdb);
  });

  // Reason: AC-179-04b — sanity inverse: explicit "document" returns the
  // document entry. Without this we couldn't distinguish a broken getter
  // that always returns rdb. Date: 2026-04-30.
  it('[AC-179-04b] getParadigmVocabulary("document") returns the document entry', () => {
    expect(getParadigmVocabulary("document")).toEqual(
      PARADIGM_VOCABULARY.document,
    );
  });

  // Reason: AC-179-04 robustness — every concrete paradigm round-trips
  // through the getter unchanged. Date: 2026-04-30.
  it("[AC-179-04c] every concrete paradigm round-trips through the getter", () => {
    for (const paradigm of ALL_PARADIGMS) {
      expect(getParadigmVocabulary(paradigm)).toEqual(
        PARADIGM_VOCABULARY[paradigm],
      );
    }
  });
});
