import { describe, it, expect, vi, beforeEach } from "vitest";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent } from "@testing-library/react";
import WorkspaceSidebar from "./WorkspaceSidebar";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";
import type { TableTab } from "@stores/workspaceStore";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Mock the heavy paradigm-specific trees so this suite stays fast and
// doesn't pull in network / virtualization machinery. The wrappers
// (RdbSidebar, DocumentSidebar) defer to these directly so it's the
// right level to mock.
vi.mock("@features/catalog", () => ({
  SchemaTree: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="schema-tree">{connectionId}</div>
  ),
  DocumentDatabaseTree: ({ connectionId }: { connectionId: string }) => (
    <div data-testid="document-database-tree">{connectionId}</div>
  ),
}));

function makeConn(
  id: string,
  overrides?: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

function makeTableTab(id: string, connectionId: string): TableTab {
  return {
    type: "table",
    id,
    title: id,
    connectionId,
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
  };
}

function setupStore(opts: {
  connections?: ConnectionConfig[];
  active?: string[];
  errored?: Record<string, string>;
  connecting?: string[];
  // Sprint 270 — defaults to `true`; legacy tests in this file all
  // exercise post-hydrate branches (empty card, paradigm sidebars, active-
  // tab priority). The pre-hydrate skeleton path is exercised by
  // `firstPaintSkeleton.test.tsx`.
  hasLoadedOnce?: boolean;
}) {
  const conns = opts.connections ?? [];
  const active = new Set(opts.active ?? []);
  const connecting = new Set(opts.connecting ?? []);
  const errored = opts.errored ?? {};
  const statuses: Record<string, ConnectionStatus> = {};
  for (const c of conns) {
    if (errored[c.id]) {
      statuses[c.id] = { type: "error", message: errored[c.id]! };
    } else if (connecting.has(c.id)) {
      statuses[c.id] = { type: "connecting" };
    } else if (active.has(c.id)) {
      statuses[c.id] = { type: "connected" };
    } else {
      statuses[c.id] = { type: "disconnected" };
    }
  }
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
    hasLoadedOnce: opts.hasLoadedOnce ?? true,
  });
}

function setActiveTab(tab: TableTab | null) {
  if (tab === null) {
    useWorkspaceStore.setState({ workspaces: {} });
    return;
  }
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
}

describe("WorkspaceSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation((command: string) => {
      if (command === "list_kv_databases") {
        return Promise.resolve([{ name: "0", index: 0, keyCount: 0 }]);
      }
      if (command === "current_kv_database") return Promise.resolve(0);
      if (command === "scan_kv_keys") {
        return Promise.resolve({
          database: 0,
          cursor: "0",
          nextCursor: "0",
          done: true,
          limit: 100,
          keys: [],
        });
      }
      return Promise.reject(new Error(`Unhandled command: ${command}`));
    });
    setupStore({});
    setActiveTab(null);
  });

  // ------------------------------------------------------------------
  // Empty / fallback states
  // ------------------------------------------------------------------

  it("shows the empty-state when no connections exist", () => {
    render(<WorkspaceSidebar selectedId={null} />);
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });

  // ------------------------------------------------------------------
  // Sprint 270 — first-paint skeleton (AC-270-01, AC-270-04)
  // ------------------------------------------------------------------

  // Sprint 270 (2026-05-13)
  // AC-270-01 — pre-hydrate the sidebar must show the shimmer skeleton, not
  // the "No connections yet" card. Otherwise on cold boot the user sees the
  // empty card for ~1.4 s and panics that their connections were deleted.
  it("AC-270-01 — renders the skeleton when connections is empty AND hasLoadedOnce is false", () => {
    setupStore({ hasLoadedOnce: false });
    render(<WorkspaceSidebar selectedId={null} />);

    const skeleton = screen.getByTestId("workspace-sidebar-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveAttribute("role", "status");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    // Four stacked rows per the spec's "Visual Direction".
    const rows = skeleton.querySelectorAll(".animate-pulse");
    expect(rows).toHaveLength(4);
    // The post-hydrate empty card must NOT be in the DOM during the
    // shimmer window — that's the visual flash this sprint is killing.
    expect(screen.queryByText(/no connections yet/i)).toBeNull();
  });

  // Sprint 270 (2026-05-13)
  // AC-270-04 — once hydration has completed, even with zero connections,
  // the skeleton must NOT re-render. The user has been told "0 connections,
  // add one" and the sidebar must stay on that surface.
  it("AC-270-04 — renders the empty card (not skeleton) when hasLoadedOnce is true and connections is empty", () => {
    setupStore({ hasLoadedOnce: true });
    render(<WorkspaceSidebar selectedId={null} />);

    expect(screen.queryByTestId("workspace-sidebar-skeleton")).toBeNull();
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
  });

  // Sprint 270 (2026-05-13)
  // AC-270-04 (remount) — flipping the flag to true and forcing a remount
  // by unmount/render must not revert to the skeleton. Verifies the
  // selector reads the live flag, not a captured-at-mount snapshot.
  it("AC-270-04 — remount after hasLoadedOnce=true still renders the empty card", () => {
    setupStore({ hasLoadedOnce: true });
    const { unmount } = render(<WorkspaceSidebar selectedId={null} />);
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
    unmount();

    render(<WorkspaceSidebar selectedId={null} />);
    expect(screen.queryByTestId("workspace-sidebar-skeleton")).toBeNull();
    expect(screen.getByText(/no connections yet/i)).toBeInTheDocument();
  });

  it("prompts to select a connection when selectedId is null and no active tab", () => {
    setupStore({ connections: [makeConn("c1")] });
    render(<WorkspaceSidebar selectedId={null} />);
    expect(screen.getByText(/select a connection/i)).toBeInTheDocument();
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });

  it("renders nothing when selectedId points at an unknown connection and no tab", () => {
    setupStore({ connections: [makeConn("c1")] });
    const { container } = render(<WorkspaceSidebar selectedId="ghost" />);
    expect(container.textContent).toBe("");
  });

  // ------------------------------------------------------------------
  // Connection state cards (connecting / error / disconnected)
  // ------------------------------------------------------------------

  it("renders the disconnected card with 'connect now' link", () => {
    const connectToDatabase = vi.fn();
    useConnectionStore.setState((s) => ({ ...s, connectToDatabase }));
    setupStore({ connections: [makeConn("c1")] });
    render(<WorkspaceSidebar selectedId="c1" />);

    expect(screen.getByText("c1 DB")).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: /connect now/i });
    fireEvent.click(btn);
    expect(connectToDatabase).toHaveBeenCalledWith("c1");
  });

  it("renders the connecting card", () => {
    setupStore({ connections: [makeConn("c1")], connecting: ["c1"] });
    render(<WorkspaceSidebar selectedId="c1" />);
    expect(screen.getByText(/connecting/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect now/i })).toBeNull();
  });

  it("renders the error card with the failure message", () => {
    setupStore({
      connections: [makeConn("c1")],
      errored: { c1: "Auth failed" },
    });
    render(<WorkspaceSidebar selectedId="c1" />);
    expect(screen.getByText(/auth failed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /connect now/i })).toBeNull();
  });

  // ------------------------------------------------------------------
  // Paradigm branches (the core sprint 126 contract)
  // ------------------------------------------------------------------

  it("renders RdbSidebar -> SchemaTree for paradigm 'rdb'", () => {
    setupStore({
      connections: [makeConn("c1", { paradigm: "rdb" })],
      active: ["c1"],
    });
    render(<WorkspaceSidebar selectedId="c1" />);
    expect(screen.getByTestId("schema-tree")).toHaveTextContent("c1");
    expect(screen.queryByTestId("document-database-tree")).toBeNull();
  });

  it("renders DocumentSidebar -> DocumentDatabaseTree for paradigm 'document'", () => {
    setupStore({
      connections: [
        makeConn("m1", { dbType: "mongodb", paradigm: "document" }),
      ],
      active: ["m1"],
    });
    render(<WorkspaceSidebar selectedId="m1" />);
    expect(screen.getByTestId("document-database-tree")).toHaveTextContent(
      "m1",
    );
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });

  it("renders KvSidebar for paradigm 'kv'", () => {
    setupStore({
      connections: [makeConn("k1", { dbType: "redis", paradigm: "kv" })],
      active: ["k1"],
    });
    render(<WorkspaceSidebar selectedId="k1" />);
    expect(
      screen.getByRole("tree", { name: /redis keys/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("schema-tree")).toBeNull();
    expect(screen.queryByTestId("document-database-tree")).toBeNull();
  });

  it("renders SearchSidebar for paradigm 'search'", async () => {
    const searchConn = makeConn("s1", {
      dbType: "elasticsearch",
      paradigm: "search",
    });
    invokeMock.mockResolvedValueOnce({
      identity: {
        product: "elasticsearch",
        clusterName: "Elasticsearch fixture",
        version: { number: "8.12.2", distribution: "elasticsearch" },
        capabilities: {
          search: true,
          aggregations: true,
          aliases: true,
          mappings: true,
          legacyIndexTemplates: true,
          composableIndexTemplates: true,
          deleteByQuery: true,
        },
        productDelta: {
          product: "elasticsearch",
          supportsElasticLicenseApi: true,
          supportsOpensearchPluginsApi: false,
          defaultTemplateEndpoint: "composableIndexTemplate",
        },
      },
      indexes: [],
      aliases: [],
      dataStreams: [],
    });
    setupStore({ connections: [searchConn], active: ["s1"] });
    render(<WorkspaceSidebar selectedId="s1" />);

    expect(
      await screen.findByRole("tree", {
        name: /elasticsearch search catalog/i,
      }),
    ).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("list_search_catalog_summary", {
      connectionId: "s1",
    });
  });

  // ------------------------------------------------------------------
  // Active-tab priority
  // ------------------------------------------------------------------

  it("active tab paradigm overrides selectedId paradigm", () => {
    const rdb = makeConn("c-rdb", { paradigm: "rdb" });
    const mongo = makeConn("c-doc", {
      dbType: "mongodb",
      paradigm: "document",
    });
    setupStore({ connections: [rdb, mongo], active: [rdb.id, mongo.id] });
    setActiveTab(makeTableTab("tab-1", mongo.id));

    render(<WorkspaceSidebar selectedId={rdb.id} />);

    // Document tree must win because the active tab points at `mongo`.
    expect(screen.getByTestId("document-database-tree")).toHaveTextContent(
      mongo.id,
    );
    expect(screen.queryByTestId("schema-tree")).toBeNull();
  });

  it("falls back to selectedId paradigm when there is no active tab", () => {
    const rdb = makeConn("c1");
    setupStore({ connections: [rdb], active: [rdb.id] });
    setActiveTab(null);

    render(<WorkspaceSidebar selectedId={rdb.id} />);
    expect(screen.getByTestId("schema-tree")).toHaveTextContent(rdb.id);
  });

  it("uses active tab even when selectedId is null", () => {
    const mongo = makeConn("m1", {
      dbType: "mongodb",
      paradigm: "document",
    });
    setupStore({ connections: [mongo], active: [mongo.id] });
    setActiveTab(makeTableTab("tab-1", mongo.id));

    render(<WorkspaceSidebar selectedId={null} />);
    expect(screen.getByTestId("document-database-tree")).toHaveTextContent(
      mongo.id,
    );
  });

  it("falls back to selectedId when active tab references a vanished connection", () => {
    const rdb = makeConn("c1");
    setupStore({ connections: [rdb], active: [rdb.id] });
    // Tab points at a connection id that does not exist in the store.
    setActiveTab(makeTableTab("tab-ghost", "nonexistent"));

    render(<WorkspaceSidebar selectedId={rdb.id} />);
    expect(screen.getByTestId("schema-tree")).toHaveTextContent(rdb.id);
  });
});
