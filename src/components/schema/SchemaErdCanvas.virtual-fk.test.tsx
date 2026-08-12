import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import {
  applyVirtualForeignKeys,
  type VirtualForeignKeyLink,
} from "@/lib/schemaGraphVirtualFk";
import { installReactFlowJsdomShims } from "@/test-utils/reactFlow";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import SchemaErdCanvas from "./SchemaErdCanvas";
import SchemaErdLegend from "./SchemaErdLegend";

/**
 * #2150 — the drawn side of the virtual FK model. The lib spec
 * (`src/lib/schemaGraphVirtualFk.test.ts`) proves the encoding table separates
 * the two kinds without colour; this proves the canvas and the legend actually
 * read that table, which a table nobody consumes would still pass.
 */
let restoreShims: () => void;

/** elkjs pays a one-off init cost, so a first card can outlive RTL's 1s. */
const ERD_LAYOUT_TIMEOUT_MS = 5000;

const POLYMORPHIC_LINK: VirtualForeignKeyLink = {
  id: "vfk-commentable",
  source: { schema: "public", table: "comments", column: "commentable_id" },
  targets: [
    { schema: "public", table: "posts", column: "id" },
    { schema: "public", table: "photos", column: "id" },
  ],
  discriminator: "commentable_type",
};

beforeAll(() => {
  restoreShims = installReactFlowJsdomShims();
});

afterAll(() => {
  restoreShims();
});

function renderCanvas(
  links: readonly VirtualForeignKeyLink[],
  onResetVirtualFks?: () => void,
) {
  const graph = applyVirtualForeignKeys(
    extractSchemaGraph(commentsSnapshot()),
    links,
  );
  return render(
    <SchemaErdCanvas graph={graph} onResetVirtualFks={onResetVirtualFks} />,
  );
}

async function findVirtualEdge(target: string) {
  return screen.findByLabelText(
    new RegExp(`virtually references public\\.${target}\\.id`, "i"),
    {},
    { timeout: ERD_LAYOUT_TIMEOUT_MS },
  );
}

describe("SchemaErdCanvas — virtual foreign keys (#2150)", () => {
  it("draws a hand-drawn link dashed and a catalog FK solid", async () => {
    renderCanvas([POLYMORPHIC_LINK]);

    const virtualEdge = await findVirtualEdge("posts");
    expect(virtualEdge).toHaveAttribute(
      "data-relationship-kind",
      "virtual-foreign-key",
    );
    expect(edgeStyle(virtualEdge)).toMatch(/stroke-dasharray:\s*6\s+4/);

    const realEdge = screen.getByLabelText(
      "public.comments.author_id references public.users.id",
    );
    expect(realEdge).toHaveAttribute("data-relationship-kind", "foreign-key");
    expect(edgeStyle(realEdge)).not.toMatch(/stroke-dasharray:\s*\d/);
  });

  it("fans a polymorphic link out to one edge per target", async () => {
    renderCanvas([POLYMORPHIC_LINK]);

    expect(await findVirtualEdge("posts")).toBeInTheDocument();
    expect(await findVirtualEdge("photos")).toBeInTheDocument();
    // The discriminator is what makes the fan readable, so it is announced.
    expect((await findVirtualEdge("posts")).getAttribute("aria-label")).toMatch(
      /via commentable_type$/,
    );
  });

  it("names both relationship kinds in the legend", async () => {
    renderCanvas([POLYMORPHIC_LINK]);
    await findVirtualEdge("posts");

    const legend = screen.getByRole("list", {
      name: /erd relationship legend/i,
    });
    expect(within(legend).getByText(/foreign key \(solid\)/i)).toBeVisible();
    expect(
      within(legend).getByText(/virtual foreign key \(dashed\)/i),
    ).toBeVisible();
  });

  it("leaves the virtual entry out of the legend when nothing is drawn", async () => {
    renderCanvas([]);
    await screen.findByRole(
      "button",
      { name: /public\.comments table/i },
      { timeout: ERD_LAYOUT_TIMEOUT_MS },
    );

    const legend = screen.getByRole("list", {
      name: /erd relationship legend/i,
    });
    expect(within(legend).getByText(/foreign key \(solid\)/i)).toBeVisible();
    expect(
      within(legend).queryByText(/virtual foreign key \(dashed\)/i),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /reset hand-drawn relationships/i }),
    ).toBeNull();
  });

  it("confirms before clearing the stored links", async () => {
    const onReset = vi.fn();
    renderCanvas([POLYMORPHIC_LINK], onReset);
    await findVirtualEdge("posts");

    fireEvent.click(
      screen.getByRole("button", { name: /reset hand-drawn relationships/i }),
    );
    // Destructive and not undoable yet (ADR 0056 (4) undo is a later issue),
    // so the click must not reach the store on its own.
    expect(onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("still offers the reset when a schema change left nothing to caption", () => {
    const onReset = vi.fn();
    // Stored links that the current schema cannot draw produce no legend
    // entries; without this the persisted rows would have no way out.
    render(<SchemaErdLegend kinds={[]} onResetVirtualFks={onReset} />);

    expect(
      screen.getByRole("button", { name: /reset hand-drawn relationships/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

function edgeStyle(edge: HTMLElement): string {
  return (
    edge.querySelector("path.react-flow__edge-path")?.getAttribute("style") ??
    ""
  );
}

function commentsSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "users"),
        table("public", "comments"),
        table("public", "posts"),
        table("public", "photos"),
      ],
    },
    columnsByTable: {
      public: {
        users: [column("id", { is_primary_key: true })],
        comments: [
          column("id", { is_primary_key: true }),
          column("commentable_id", { data_type: "bigint" }),
          column("commentable_type", { data_type: "text" }),
          column("author_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
        ],
        posts: [column("id", { is_primary_key: true })],
        photos: [column("id", { is_primary_key: true })],
      },
    },
    indexesByTable: {},
    constraintsByTable: {},
  };
}

function table(schema: string, name: string): TableInfo {
  return { schema, name, row_count: null };
}

function column(name: string, overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name,
    data_type: "integer",
    nullable: false,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
    ...overrides,
  };
}
