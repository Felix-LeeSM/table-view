// Guards the --scenario domain filter (filterByDomain in spec.ts): pruning to a
// domain subset, the unknown-domain guard, and the cross-domain FK guard that
// stops a scenario from silently losing referential integrity.
import { describe, it, expect } from "vitest";
import { filterByDomain, loadSpec, type BaseSpec } from "./spec.js";

describe("filterByDomain", () => {
  it("null/empty is a no-op (keeps every entity)", () => {
    const base = loadSpec("development").base;
    const before = Object.keys(base.entities).length;
    filterByDomain(base, null);
    filterByDomain(base, []);
    expect(Object.keys(base.entities).length).toBe(before);
  });

  it("prunes to the selected domain", () => {
    const base = loadSpec("development").base;
    filterByDomain(base, ["iot"]);
    expect(Object.keys(base.entities).sort()).toEqual([
      "device_zones",
      "devices",
      "sensor_readings",
    ]);
    for (const e of Object.values(base.entities)) expect(e.domain).toBe("iot");
  });

  it("supports multiple domains", () => {
    const base = loadSpec("development").base;
    filterByDomain(base, ["iot", "social"]);
    const domains = new Set(Object.values(base.entities).map((e) => e.domain));
    expect(domains).toEqual(new Set(["iot", "social"]));
  });

  it("throws on an unknown domain", () => {
    const base = loadSpec("development").base;
    expect(() => filterByDomain(base, ["nope"])).toThrow(/unknown domain/);
  });

  it("throws if pruning would break a cross-domain FK", () => {
    const base: BaseSpec = {
      entities: {
        parent: {
          targets: ["pg"],
          domain: "commerce",
          columns: { id: { type: "uuid", primary: true } },
        },
        child: {
          targets: ["pg"],
          domain: "iot",
          columns: {
            id: { type: "uuid", primary: true },
            p: { type: "ref", to: "parent.id" },
          },
        },
      },
    };
    expect(() => filterByDomain(base, ["iot"])).toThrow(/would break FK/);
  });
});
