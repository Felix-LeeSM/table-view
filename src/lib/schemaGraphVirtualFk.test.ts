import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetErdVirtualFkStoreForTests,
  erdVirtualFkSettingKey,
  useErdVirtualFkStore,
} from "@/stores/erdVirtualFkStore";
import type { ColumnInfo, TableInfo } from "@/types/schema";
import type {
  SchemaGraphCatalogSnapshot,
  SchemaGraphEdge,
} from "@/types/schemaGraph";
import { extractSchemaGraph } from "./schemaGraph";
import {
  applyVirtualForeignKeys,
  ERD_RELATIONSHIP_ENCODINGS,
  parseVirtualForeignKeyLinks,
  reconcileVirtualForeignKeys,
  VIRTUAL_FOREIGN_KEY_EDGE_KIND,
  type VirtualForeignKeyLink,
} from "./schemaGraphVirtualFk";

/**
 * #2150 acceptance — draw a virtual FK, close the ERD tab, open it again and
 * find the same edge (ADR 0055 "표시 + 저장 + reconcile", ADR 0056 (1)).
 *
 * The fake stands in for the SQLite `settings` table rather than for the typed
 * wrapper, so the round trip runs through the real `persistSettingValue`
 * serialization and the real `getSetting` read — a shape change on either side
 * fails here instead of passing against a stub.
 */
const { settingsRows } = vi.hoisted(() => ({
  settingsRows: new Map<string, string>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string, args: Record<string, unknown>) => {
    if (command === "persist_setting") {
      const req = args.req as { key: string; valueJson: string };
      settingsRows.set(req.key, req.valueJson);
      return Promise.resolve();
    }
    if (command === "get_setting") {
      return Promise.resolve(settingsRows.get(args.key as string) ?? null);
    }
    if (command === "reset_setting") {
      settingsRows.delete(args.key as string);
      return Promise.resolve();
    }
    return Promise.resolve(null);
  }),
}));

const CONNECTION_ID = "conn-1";
const DATABASE = "app";

/** Rails-style polymorphic association: `commentable_id` + `commentable_type`. */
const POLYMORPHIC_LINK: VirtualForeignKeyLink = {
  id: "vfk-commentable",
  source: { schema: "public", table: "comments", column: "commentable_id" },
  targets: [
    { schema: "public", table: "posts", column: "id" },
    { schema: "public", table: "photos", column: "id" },
  ],
  discriminator: "commentable_type",
};

beforeEach(() => {
  settingsRows.clear();
  __resetErdVirtualFkStoreForTests();
});

describe("virtual FK model — polymorphic targets + discriminator", () => {
  it("fans one link out to every target and keeps the discriminator", () => {
    const graph = applyVirtualForeignKeys(catalogGraph(), [POLYMORPHIC_LINK]);
    const drawn = virtualEdges(graph.edges);

    expect(drawn.map((edge) => edge.to)).toEqual([
      "table:public.photos",
      "table:public.posts",
    ]);
    for (const edge of drawn) {
      expect(edge.from).toBe("table:public.comments");
      expect(edge.virtualForeignKey?.linkId).toBe("vfk-commentable");
      expect(edge.virtualForeignKey?.discriminator).toBe("commentable_type");
      expect(edge.virtualForeignKey?.polymorphic).toBe(true);
      expect(edge.virtualForeignKey?.source.columns).toEqual([
        "commentable_id",
      ]);
    }
  });

  it("leaves the catalog FK edges untouched next to the drawn ones", () => {
    const catalog = catalogGraph();
    const graph = applyVirtualForeignKeys(catalog, [POLYMORPHIC_LINK]);

    expect(
      graph.edges.filter((edge) => edge.kind === "foreign-key-table"),
    ).toEqual(
      catalog.edges.filter((edge) => edge.kind === "foreign-key-table"),
    );
  });
});

describe("virtual FK persistence — close the tab, open it again", () => {
  it("draws the same edges after the ERD tab is closed and reopened", async () => {
    const store = useErdVirtualFkStore.getState();
    await store.addVirtualFk(CONNECTION_ID, DATABASE, POLYMORPHIC_LINK);
    const beforeClose = virtualEdges(
      applyVirtualForeignKeys(catalogGraph(), linksInStore()).edges,
    ).map((edge) => edge.id);
    expect(beforeClose).toHaveLength(2);

    // Closing the tab unmounts `SchemaErdPanel`; nothing but SQLite is left.
    __resetErdVirtualFkStoreForTests();
    expect(linksInStore()).toEqual([]);

    // Reopening mounts it again, and its effect hydrates from SQLite.
    await useErdVirtualFkStore
      .getState()
      .hydrateVirtualFks(CONNECTION_ID, DATABASE);
    const reopened = applyVirtualForeignKeys(catalogGraph(), linksInStore());

    expect(virtualEdges(reopened.edges).map((edge) => edge.id)).toEqual(
      beforeClose,
    );
    expect(linksInStore()).toEqual([POLYMORPHIC_LINK]);
  });

  it("writes the link under a key scoped to the connection and database", async () => {
    await useErdVirtualFkStore
      .getState()
      .addVirtualFk(CONNECTION_ID, DATABASE, POLYMORPHIC_LINK);

    expect([...settingsRows.keys()]).toEqual([
      erdVirtualFkSettingKey(CONNECTION_ID, DATABASE),
    ]);
    // A second database on the same connection starts empty rather than
    // inheriting links drawn against a schema it does not have.
    await useErdVirtualFkStore
      .getState()
      .hydrateVirtualFks(CONNECTION_ID, "reporting");
    expect(
      useErdVirtualFkStore.getState().linksByScope[
        erdVirtualFkSettingKey(CONNECTION_ID, "reporting")
      ],
    ).toBeUndefined();
  });

  it("clears the diagram and deletes the row when the links are reset", async () => {
    const store = useErdVirtualFkStore.getState();
    await store.addVirtualFk(CONNECTION_ID, DATABASE, POLYMORPHIC_LINK);
    await store.resetVirtualFks(CONNECTION_ID, DATABASE);

    expect(linksInStore()).toEqual([]);
    expect(settingsRows.size).toBe(0);
    await store.hydrateVirtualFks(CONNECTION_ID, DATABASE);
    expect(linksInStore()).toEqual([]);
  });

  it("keeps the links it has when the stored value is unreadable", async () => {
    await useErdVirtualFkStore
      .getState()
      .addVirtualFk(CONNECTION_ID, DATABASE, POLYMORPHIC_LINK);
    settingsRows.set(
      erdVirtualFkSettingKey(CONNECTION_ID, DATABASE),
      "{ not json",
    );

    await useErdVirtualFkStore
      .getState()
      .hydrateVirtualFks(CONNECTION_ID, DATABASE);

    expect(linksInStore()).toEqual([POLYMORPHIC_LINK]);
  });

  it("drops a malformed entry without losing the rest of the list", () => {
    const parsed = parseVirtualForeignKeyLinks(
      JSON.stringify([
        POLYMORPHIC_LINK,
        { id: "no-targets", source: POLYMORPHIC_LINK.source, targets: [] },
        { source: POLYMORPHIC_LINK.source, targets: POLYMORPHIC_LINK.targets },
      ]),
    );

    expect(parsed).toEqual([POLYMORPHIC_LINK]);
    expect(parseVirtualForeignKeyLinks("[]")).toEqual([]);
    expect(parseVirtualForeignKeyLinks("nonsense")).toBeNull();
  });
});

describe("virtual FK reconcile against the current schema", () => {
  it("keeps drawing the targets that are still there and drops the one that left", () => {
    const graph = catalogGraph({ withPhotos: false });

    const [reconciled] = reconcileVirtualForeignKeys([POLYMORPHIC_LINK], graph);

    expect(reconciled?.targets).toEqual([
      { schema: "public", table: "posts", column: "id" },
    ]);
    expect(
      virtualEdges(
        applyVirtualForeignKeys(graph, [POLYMORPHIC_LINK]).edges,
      ).map((edge) => edge.to),
    ).toEqual(["table:public.posts"]);
  });

  it("draws nothing once every target is gone, and keeps the stored link", async () => {
    await useErdVirtualFkStore
      .getState()
      .addVirtualFk(CONNECTION_ID, DATABASE, POLYMORPHIC_LINK);
    const graph = catalogGraph({ withPhotos: false, withPosts: false });

    expect(reconcileVirtualForeignKeys(linksInStore(), graph)).toEqual([]);
    expect(applyVirtualForeignKeys(graph, linksInStore()).edges).toEqual(
      graph.edges,
    );
    // Pruning is a projection: a link the current schema cannot draw is still
    // stored, so it comes back with the table instead of being destroyed.
    expect(linksInStore()).toEqual([POLYMORPHIC_LINK]);
    expect(
      virtualEdges(
        applyVirtualForeignKeys(catalogGraph(), linksInStore()).edges,
      ),
    ).toHaveLength(2);
  });

  it("draws nothing when the source column itself left the schema", () => {
    const graph = catalogGraph();
    const renamedSource: VirtualForeignKeyLink = {
      ...POLYMORPHIC_LINK,
      source: {
        schema: "public",
        table: "comments",
        column: "commentable_ref",
      },
    };

    expect(reconcileVirtualForeignKeys([renamedSource], graph)).toEqual([]);
    expect(
      virtualEdges(applyVirtualForeignKeys(graph, [renamedSource]).edges),
    ).toEqual([]);
  });

  it("drops a discriminator whose column left but keeps the link", () => {
    const graph = catalogGraph({ withDiscriminator: false });

    const [reconciled] = reconcileVirtualForeignKeys([POLYMORPHIC_LINK], graph);

    expect(reconciled?.discriminator).toBeUndefined();
    expect(reconciled?.targets).toHaveLength(2);
  });
});

describe("relationship encoding", () => {
  it("tells the two kinds apart on a channel that is not colour", () => {
    const real = ERD_RELATIONSHIP_ENCODINGS["foreign-key"];
    const virtual = ERD_RELATIONSHIP_ENCODINGS["virtual-foreign-key"];

    // A tint difference alone is invisible to a colour-blind reader, so the
    // encoding table carries no colour at all — the canvas keeps its palette.
    for (const key of Object.keys(real)) {
      expect(key).not.toMatch(/colou?r|fill|tone|hue/i);
    }
    expect(virtual.strokeDasharray).not.toBe(real.strokeDasharray);
    expect(virtual.marker).not.toBe(real.marker);
    expect(virtual.legendKey).not.toBe(real.legendKey);
  });
});

function linksInStore(): readonly VirtualForeignKeyLink[] {
  return (
    useErdVirtualFkStore.getState().linksByScope[
      erdVirtualFkSettingKey(CONNECTION_ID, DATABASE)
    ] ?? []
  );
}

function virtualEdges(edges: readonly SchemaGraphEdge[]): SchemaGraphEdge[] {
  return edges.filter((edge) => edge.kind === VIRTUAL_FOREIGN_KEY_EDGE_KIND);
}

function catalogGraph(
  options: {
    withPosts?: boolean;
    withPhotos?: boolean;
    withDiscriminator?: boolean;
  } = {},
) {
  return extractSchemaGraph(commentsSnapshot(options));
}

function commentsSnapshot({
  withPosts = true,
  withPhotos = true,
  withDiscriminator = true,
}: {
  withPosts?: boolean;
  withPhotos?: boolean;
  withDiscriminator?: boolean;
}): SchemaGraphCatalogSnapshot {
  const tables = [
    table("public", "users"),
    table("public", "comments"),
    ...(withPosts ? [table("public", "posts")] : []),
    ...(withPhotos ? [table("public", "photos")] : []),
  ];
  return {
    source: { dbType: "postgresql", database: DATABASE },
    schemas: [{ name: "public" }],
    tablesBySchema: { public: tables },
    columnsByTable: {
      public: {
        users: [column("id", { is_primary_key: true })],
        comments: [
          column("id", { is_primary_key: true }),
          column("commentable_id", { data_type: "bigint" }),
          ...(withDiscriminator
            ? [column("commentable_type", { data_type: "text" })]
            : []),
          // A real FK so both relationship kinds share one diagram.
          column("author_id", {
            is_foreign_key: true,
            fk_reference: "public.users(id)",
          }),
        ],
        ...(withPosts
          ? { posts: [column("id", { is_primary_key: true })] }
          : {}),
        ...(withPhotos
          ? { photos: [column("id", { is_primary_key: true })] }
          : {}),
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
