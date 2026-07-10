import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CollectionRow } from "./rows";
import type { CollectionInfo } from "@/types/document";

// #1140 — guard the aria-override fix. The collection treeitem keeps its
// identifying aria-label (stable SR name + 200+ test queries depend on it) but
// wires every badge into aria-describedby so row metadata reaches SR instead of
// being masked by the override.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Surface the count verbatim in the doc-count aria-label so the assertion
    // matches a real fragment; pass the type through; other keys return as-is.
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts && typeof opts.count === "number") return `count ${opts.count}`;
      if (opts && typeof opts.type === "string") return opts.type;
      return key;
    },
  }),
}));

function makeCollection(
  overrides: Partial<CollectionInfo> = {},
): CollectionInfo {
  return {
    name: "orders",
    database: "shop",
    collection_type: "collection",
    document_count: 1234,
    read_only: false,
    options: {},
    id_index: null,
    ...overrides,
  };
}

const baseProps = {
  database: "shop",
  isSelected: false,
  onSelect: vi.fn(),
  onOpen: vi.fn(),
  onDoubleOpen: vi.fn(),
  onRequestDrop: vi.fn(),
  treeKey: "collection:shop:orders",
  tabIndex: 0,
  onFocus: vi.fn(),
  posInSet: 1,
  setSize: 1,
};

function describedbyTargets(row: HTMLElement): HTMLElement[] {
  const id = row.getAttribute("aria-describedby");
  if (!id) return [];
  return id
    .split(" ")
    .map((x) => document.getElementById(x))
    .filter((el): el is HTMLElement => el != null);
}

describe("CollectionRow — SR metadata exposure (issue #1140)", () => {
  it("keeps the identifying aria-label as the accessible name", () => {
    render(
      <CollectionRow
        {...baseProps}
        collection={makeCollection({ document_count: 1234 })}
      />,
    );

    // Mock returns the i18n key verbatim for collectionRowAria; the point is
    // that an aria-label override is still present (stable name).
    expect(screen.getByRole("treeitem")).toHaveAttribute(
      "aria-label",
      "collectionRowAria",
    );
  });

  it("exposes the document count to SR via aria-describedby", () => {
    render(
      <CollectionRow
        {...baseProps}
        collection={makeCollection({ document_count: 1234 })}
      />,
    );

    const targets = describedbyTargets(screen.getByRole("treeitem"));
    const docTarget = targets.find((el) =>
      el.getAttribute("aria-label")?.includes("1234"),
    );
    expect(docTarget).toBeTruthy();
  });

  it("exposes the read-only badge to SR via aria-describedby", () => {
    render(
      <CollectionRow
        {...baseProps}
        collection={makeCollection({ read_only: true })}
      />,
    );

    const targets = describedbyTargets(screen.getByRole("treeitem"));
    expect(
      targets.some((el) =>
        /ReadOnly/i.test(el.getAttribute("aria-label") ?? ""),
      ),
    ).toBe(true);
  });

  it("omits aria-describedby when the collection has no badges", () => {
    render(
      <CollectionRow
        {...baseProps}
        collection={makeCollection({ document_count: null })}
      />,
    );

    // Plain collection, no read-only/options/id-index, null doc count → nothing
    // to describe. describedby should be absent so SR don't chase dead refs.
    expect(screen.getByRole("treeitem")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
