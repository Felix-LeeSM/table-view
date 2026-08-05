import { describe, expect, it } from "vitest";
import { THEME_CATALOG } from "@/lib/themeCatalog";
import { assertSweepIsComplete } from "@/test-utils/themePalettes";

const everyBlock = () =>
  THEME_CATALOG.flatMap((t) => [`${t.id} light`, `${t.id} dark`]);

describe("assertSweepIsComplete", () => {
  it("accepts both modes of every catalog theme", () => {
    expect(() => assertSweepIsComplete(everyBlock())).not.toThrow();
  });

  it("throws when a block is missing", () => {
    expect(() => assertSweepIsComplete(everyBlock().slice(1))).toThrow(
      /sweep covers/,
    );
  });

  it("throws on a swept name the catalog does not list, block count unchanged", () => {
    const [first, ...rest] = everyBlock();
    expect(() =>
      assertSweepIsComplete([first!.replace(/^\S+/, "not-a-theme"), ...rest]),
    ).toThrow(/sweep covers/);
  });

  it("throws on a catalog theme no block covers, block count unchanged", () => {
    const [dropped, ...rest] = THEME_CATALOG.map((t) => t.id);
    expect(() =>
      assertSweepIsComplete([
        ...rest.flatMap((id) => [`${id} light`, `${id} dark`]),
        `${rest[0]} light`,
        `${rest[0]} dark`,
      ]),
    ).toThrow(new RegExp(`Missing from src/themes\\.css: \\[${dropped}\\]`));
  });
});
