import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BsonTreeViewer, { detectBsonBadge } from "./BsonTreeViewer";

// `userEvent.setup()` (used by the keyboard test) installs its own
// `navigator.clipboard` implementation, which shadows whatever we attach at
// module level. Re-installing the mock inside `beforeEach` guarantees every
// test sees our own `writeText` mock regardless of previous test state.
// We also use `fireEvent` for clipboard-interacting tests (same pattern as
// `DataGridTable.context-menu.test.tsx`) to avoid `userEvent.setup()`
// re-pointing `navigator.clipboard` mid-test.
const writeText = vi.fn(() => Promise.resolve());

describe("BsonTreeViewer", () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockImplementation(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  // ── Tree render ──────────────────────────────────────────────────────

  it("renders a nested document/array as a tree with root expanded", () => {
    render(
      <BsonTreeViewer
        value={{
          name: "alice",
          tags: ["admin", "ops"],
          profile: { email: "a@x.dev" },
        }}
      />,
    );

    const tree = screen.getByRole("tree", { name: "BSON document tree" });
    expect(tree).toBeInTheDocument();

    expect(
      within(tree).getByRole("button", { name: "name" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("button", { name: "tags" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("button", { name: "profile" }),
    ).toBeInTheDocument();

    expect(within(tree).getByText('"alice"')).toBeInTheDocument();

    expect(
      within(tree).getByRole("button", { name: "[0]" }),
    ).toBeInTheDocument();
    expect(
      within(tree).getByRole("button", { name: "[1]" }),
    ).toBeInTheDocument();
  });

  // ── aria-expanded + keyboard ─────────────────────────────────────────

  it("toggles aria-expanded on mouse click and keyboard (Enter/Space)", async () => {
    const user = userEvent.setup();
    render(
      <BsonTreeViewer
        value={{
          deep: { inner: { leaf: 1 } },
        }}
      />,
    );

    const deepNode = screen.getByRole("treeitem", { name: "deep node" });
    expect(deepNode).toHaveAttribute("aria-expanded", "true");

    const innerNode = screen.getByRole("treeitem", { name: "inner node" });
    expect(innerNode).toHaveAttribute("aria-expanded", "false");

    const expandBtn = within(innerNode).getByRole("button", {
      name: /^Expand inner$/,
    });
    await user.click(expandBtn);
    expect(innerNode).toHaveAttribute("aria-expanded", "true");

    const collapseBtn = within(innerNode).getByRole("button", {
      name: /^Collapse inner$/,
    });
    collapseBtn.focus();
    await user.keyboard("{Enter}");
    expect(innerNode).toHaveAttribute("aria-expanded", "false");

    const reExpandBtn = within(innerNode).getByRole("button", {
      name: /^Expand inner$/,
    });
    reExpandBtn.focus();
    await user.keyboard(" ");
    expect(innerNode).toHaveAttribute("aria-expanded", "true");
  });

  // ── Badge whitelist (7 types) ────────────────────────────────────────

  it("renders canonical extended JSON wrappers as scalar badges", () => {
    render(
      <BsonTreeViewer
        value={{
          id: { $oid: "507f1f77bcf86cd799439011" },
          createdAt: { $date: "2026-04-24T00:00:00Z" },
          bigInt: { $numberLong: "9223372036854775807" },
          ratio: { $numberDouble: "3.14" },
          count: { $numberInt: "42" },
          price: { $numberDecimal: "19.99" },
          blob: { $binary: "AQID", $type: "00" },
        }}
      />,
    );

    expect(screen.getByText("ObjectId")).toBeInTheDocument();
    expect(screen.getByText("ISODate")).toBeInTheDocument();
    expect(screen.getByText("NumberLong")).toBeInTheDocument();
    expect(screen.getByText("NumberDouble")).toBeInTheDocument();
    expect(screen.getByText("NumberInt")).toBeInTheDocument();
    expect(screen.getByText("Decimal128")).toBeInTheDocument();
    expect(screen.getByText("Binary")).toBeInTheDocument();
  });

  // ── Whitelist miss: $comment stays a plain object ────────────────────

  it("does not misdetect non-whitelisted $-keys as badges", () => {
    render(<BsonTreeViewer value={{ doc: { $comment: "note" } }} />);

    expect(screen.queryByText("Comment")).not.toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: "$comment" }),
    ).toBeInTheDocument();

    expect(detectBsonBadge({ $comment: "note" })).toBeNull();
  });

  // ── Copy path ────────────────────────────────────────────────────────

  it("copies the field path to clipboard on key click", async () => {
    render(
      <BsonTreeViewer
        value={{
          user: {
            profile: {
              emails: ["a@x.dev", "b@x.dev"],
            },
          },
        }}
      />,
    );

    // Depth 2 `profile` is collapsed by default → expand it so `emails` is in
    // the DOM, then expand `emails` similarly.
    fireEvent.click(screen.getByRole("button", { name: /^Expand profile$/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Expand emails$/ }));

    fireEvent.click(screen.getByRole("button", { name: "[0]" }));

    // `handleCopyPath` is async, but `navigator.clipboard.writeText` is
    // reached synchronously before any `await` returns, so the mock is
    // recorded by the time `fireEvent.click` resolves.
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("user.profile.emails[0]");
    });
  });

  // ── Copy value ───────────────────────────────────────────────────────

  it("copies the canonical JSON of a scalar node via Copy value", async () => {
    render(<BsonTreeViewer value={{ count: 42 }} />);

    const copyBtn = screen.getByRole("button", {
      name: /^Copy value at count$/,
    });
    fireEvent.click(copyBtn);

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("42");
    });
  });

  it("copies the canonical JSON of a string scalar with quotes", async () => {
    render(<BsonTreeViewer value={{ greeting: "hello" }} />);
    const copyBtn = screen.getByRole("button", {
      name: /^Copy value at greeting$/,
    });
    fireEvent.click(copyBtn);

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('"hello"');
    });
  });

  it("copies indented JSON for an object container value", async () => {
    // Containers (objects/arrays) use `JSON.stringify(value, null, 2)` so
    // the clipboard payload is human-readable in an editor (contract AC-06).
    render(
      <BsonTreeViewer
        value={{
          profile: { email: "a@x.dev", age: 30 },
        }}
      />,
    );

    const copyBtn = screen.getByRole("button", {
      name: /^Copy value at profile$/,
    });
    fireEvent.click(copyBtn);

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify({ email: "a@x.dev", age: 30 }, null, 2),
      );
    });
  });

  it("copies indented JSON for an array container value", async () => {
    render(<BsonTreeViewer value={{ tags: ["admin", "ops"] }} />);

    const copyBtn = screen.getByRole("button", {
      name: /^Copy value at tags$/,
    });
    fireEvent.click(copyBtn);

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        JSON.stringify(["admin", "ops"], null, 2),
      );
    });
  });

  it("uses bracket-quote path form for non-identifier keys", async () => {
    // Keys that don't match `[A-Za-z_$][\w$]*` must copy as `["key"]`.
    render(<BsonTreeViewer value={{ "foo bar": 1 }} />);

    // The key-label button is rendered with the raw key text.
    fireEvent.click(screen.getByRole("button", { name: "foo bar" }));

    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('["foo bar"]');
    });
  });

  // ── Null safety ──────────────────────────────────────────────────────

  it("renders a safe empty state when the value is null", () => {
    render(<BsonTreeViewer value={null} />);
    expect(
      screen.getByRole("tree", { name: "BSON document tree" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No document selected")).toBeInTheDocument();
  });

  // ── detectBsonBadge unit behaviour ───────────────────────────────────

  it("detectBsonBadge accepts the $binary + $type 2-key wrapper only", () => {
    expect(detectBsonBadge({ $binary: "AQID", $type: "00" })?.label).toBe(
      "Binary",
    );
    expect(detectBsonBadge({ $oid: "abc", $foo: "bar" })).toBeNull();
    expect(detectBsonBadge({})).toBeNull();
    expect(detectBsonBadge([1, 2])).toBeNull();
    expect(detectBsonBadge("x")).toBeNull();
    expect(detectBsonBadge(null)).toBeNull();
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  it("renders an empty object without throwing", () => {
    render(<BsonTreeViewer value={{}} />);
    expect(
      screen.getByRole("tree", { name: "BSON document tree" }),
    ).toBeInTheDocument();
  });

  it("renders an empty array without throwing", () => {
    render(<BsonTreeViewer value={[]} />);
    expect(
      screen.getByRole("tree", { name: "BSON document tree" }),
    ).toBeInTheDocument();
  });

  it("renders a 6-deep nested structure without crashing", () => {
    const deep = { a: { b: { c: { d: { e: { f: "leaf" } } } } } };
    render(<BsonTreeViewer value={deep} />);
    expect(
      screen.getByRole("tree", { name: "BSON document tree" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "a" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "b" })).toBeInTheDocument();
    expect(screen.queryByText("f")).toBeNull();
  });
});
