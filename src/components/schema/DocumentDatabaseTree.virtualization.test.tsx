import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import DocumentDatabaseTree from "./DocumentDatabaseTree";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import type { CollectionInfo } from "@/types/document";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";

/**
 * #1445 — DocumentDatabaseTree used to render every db + collection row
 * ("Non-virtualized" comment). A Mongo database with thousands of
 * collections mounted them all and hung the tab. It now windows past the
 * shared threshold. jsdom reports zero-size elements, so the same
 * `HTMLElement.prototype` size polyfill SchemaTree's virtualization test uses
 * lifts a stable viewport. RED (pre-fix): every collection renders, so the
 * windowed assertion fails.
 */

const VIEWPORT_HEIGHT = 600;

function collectionFixture(name: string, database: string): CollectionInfo {
  return {
    name,
    database,
    collection_type: "collection",
    document_count: 0,
    read_only: false,
    options: {},
    id_index: null,
  };
}

const originalOffsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetWidth",
);
const originalOffsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
const originalClientHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "clientHeight",
);
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;

describe("DocumentDatabaseTree virtualization (#1445)", () => {
  beforeEach(() => {
    __resetDocumentStoreForTests();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ activeStatuses: {}, connections: [] });
    setupTauriMock({
      listMongoDatabases: vi.fn(() => Promise.resolve([{ name: "bigdb" }])),
      listMongoCollections: vi.fn(() =>
        Promise.resolve(
          Array.from({ length: 500 }, (_, i) =>
            collectionFixture(`coll_${String(i).padStart(4, "0")}`, "bigdb"),
          ),
        ),
      ),
      inferCollectionFields: vi.fn(() => Promise.resolve([])),
    });

    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 320;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return VIEWPORT_HEIGHT;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function () {
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 320,
        bottom: VIEWPORT_HEIGHT,
        width: 320,
        height: VIEWPORT_HEIGHT,
        toJSON() {
          return {};
        },
      } as DOMRect;
    };
  });

  afterEach(() => {
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    if (originalOffsetHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetHeight",
        originalOffsetHeight,
      );
    }
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
    }
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("windows a database with hundreds of collections instead of rendering all", async () => {
    render(<DocumentDatabaseTree connectionId="conn-mongo-big" />);
    await waitFor(() => {
      expect(screen.getByLabelText("bigdb database")).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("bigdb database"));
    });
    await waitFor(() => {
      expect(screen.getByLabelText("coll_0000 collection")).toBeInTheDocument();
    });

    // 1 db + 500 collections = 501 flat rows > threshold ⇒ only a
    // viewport-sized window of collection rows is in the DOM.
    const collRows = screen.getAllByLabelText(/^coll_\d+ collection$/);
    expect(collRows.length).toBeGreaterThan(0);
    expect(collRows.length).toBeLessThanOrEqual(100);
    // A far-tail collection is windowed out.
    expect(screen.queryByLabelText("coll_0499 collection")).toBeNull();
  });
});
