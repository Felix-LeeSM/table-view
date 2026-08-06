import { fireEvent, render, screen, within } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { extractSchemaGraph } from "@/lib/schemaGraph";
import { installReactFlowJsdomShims } from "@/test-utils/reactFlow";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";

// The duration React Flow animates with is only observable at the call — d3's
// transition state is not readable back out — so the viewport handle is the
// boundary this spec stubs. Everything else in `@xyflow/react` stays real, so
// the canvas still lays out and renders its nodes.
const viewport = vi.hoisted(() => ({
  fitView: vi.fn(),
  getNode: vi.fn(() => ({
    id: "table:public.payments",
    position: { x: 10, y: 20 },
    width: 200,
    height: 120,
  })),
  setCenter: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return { ...actual, useReactFlow: () => viewport };
});

import SchemaErdCanvas from "./SchemaErdCanvas";

// Mirrors `ERD_TRANSITION_MS` in `SchemaErdCanvas.tsx`, which is module-private.
const ANIMATED_MS = 200;

/** elkjs pays a one-off init cost, so the first card can outrun RTL's 1s. */
const ERD_LAYOUT_TIMEOUT_MS = 5000;

const originalMatchMedia = window.matchMedia;
let restoreShims: () => void;

/**
 * Stands in for the OS "reduce motion" toggle. Keyed on the query text so an
 * implementation that asks for some other media feature fails here.
 */
function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/**
 * Renders with a table already selected so the "fit selected table" control is
 * enabled, then drops the mount-time `fitView` the auto-fit effect issues.
 */
async function renderCanvas() {
  render(
    <SchemaErdCanvas
      graph={extractSchemaGraph(ordersSnapshot())}
      selectedTableId="table:public.users"
    />,
  );
  await screen.findByRole(
    "button",
    { name: /public\.users table/i },
    { timeout: ERD_LAYOUT_TIMEOUT_MS },
  );
  vi.clearAllMocks();
}

function clickSearchResult() {
  fireEvent.change(screen.getByRole("textbox", { name: /search erd/i }), {
    target: { value: "pay" },
  });
  const results = screen.getByRole("listbox", {
    name: /erd table search results/i,
  });
  fireEvent.click(
    within(results).getByRole("option", { name: "public.payments" }),
  );
}

beforeAll(() => {
  restoreShims = installReactFlowJsdomShims();
});

afterAll(() => {
  restoreShims();
  window.matchMedia = originalMatchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

// Reason: 이슈 #2152 — reduced-motion 이면 ERD 캔버스 전환이 0ms 여야 한다.
// 두 방향을 같은 목록으로 돈다: 켜져 있으면 0ms, 꺼져 있으면 기존 200ms 그대로
// (한 방향만 재면 "언제나 0ms" 인 구현도 통과한다).
describe.each([
  { motion: "reduce", reduced: true, expected: 0 },
  { motion: "no-preference", reduced: false, expected: ANIMATED_MS },
])(
  "ERD canvas transitions under prefers-reduced-motion: $motion",
  ({ reduced, expected }) => {
    beforeEach(() => {
      setReducedMotion(reduced);
    });

    it("zooms out over the resolved duration", async () => {
      await renderCanvas();

      fireEvent.click(screen.getByRole("button", { name: /zoom out/i }));

      expect(viewport.zoomOut).toHaveBeenCalledWith({ duration: expected });
    });

    it("zooms in over the resolved duration", async () => {
      await renderCanvas();

      fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));

      expect(viewport.zoomIn).toHaveBeenCalledWith({ duration: expected });
    });

    it("fits the whole diagram over the resolved duration", async () => {
      await renderCanvas();

      fireEvent.click(screen.getByRole("button", { name: /fit erd/i }));

      expect(viewport.fitView).toHaveBeenCalledWith({
        padding: 0.15,
        duration: expected,
      });
    });

    it("fits the selected table over the resolved duration", async () => {
      await renderCanvas();

      fireEvent.click(
        screen.getByRole("button", { name: /fit selected table/i }),
      );

      expect(viewport.fitView).toHaveBeenCalledWith({
        nodes: [{ id: "table:public.users" }],
        padding: 0.4,
        maxZoom: 1.2,
        duration: expected,
      });
    });

    it("recenters on a searched table over the resolved duration", async () => {
      await renderCanvas();

      clickSearchResult();

      expect(viewport.setCenter).toHaveBeenCalledWith(110, 80, {
        zoom: expect.any(Number),
        duration: expected,
      });
    });
  },
);

// A runtime without `matchMedia` must still animate rather than throw out of the
// click handler and leave the toolbar dead.
it("keeps the animated duration when matchMedia is unavailable", async () => {
  // `test-setup.ts` defines the property non-configurable, so it can be
  // overwritten but not deleted.
  window.matchMedia = undefined as unknown as typeof window.matchMedia;
  await renderCanvas();

  fireEvent.click(screen.getByRole("button", { name: /zoom in/i }));

  expect(viewport.zoomIn).toHaveBeenCalledWith({ duration: ANIMATED_MS });
});

function ordersSnapshot(): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType: "postgresql", database: "app" },
    schemas: [{ name: "public" }],
    tablesBySchema: {
      public: [
        table("public", "users"),
        table("public", "orders"),
        table("public", "payments"),
      ],
    },
    columnsByTable: {
      public: {
        users: [
          column("id", { is_primary_key: true }),
          column("email", { data_type: "text" }),
        ],
        orders: [
          column("id", { is_primary_key: true }),
          column("user_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
        ],
        payments: [
          column("id", { is_primary_key: true }),
          column("order_id", {
            is_foreign_key: true,
            fk_reference: "public.orders(id)",
          }),
        ],
      },
    },
    constraintsByTable: {},
    indexesByTable: {},
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
