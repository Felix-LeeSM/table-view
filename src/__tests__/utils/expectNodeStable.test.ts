/**
 * Sprint-88 AC-02: self-verification for `expectNodeStable`.
 *
 * Covers the canonical scenarios from `.claude/rules/test-scenarios.md`:
 * - Happy path: same DOM node identity → passes silently.
 * - Error case: unmount/remount → fails with a descriptive message.
 * - Boundary: getter throws on re-invocation → wrapped error mentions unmount.
 * - Boundary: capture-time falsy value → synchronous failure.
 */
import { afterEach, describe, expect, it } from "vitest";
import { expectNodeStable } from "./expectNodeStable";

const HOST = "expect-node-stable-host";

function setupHost(): HTMLElement {
  let host = document.getElementById(HOST);
  if (!host) {
    host = document.createElement("div");
    host.id = HOST;
    document.body.appendChild(host);
  }
  host.innerHTML = "";
  return host;
}

describe("expectNodeStable", () => {
  afterEach(() => {
    const host = document.getElementById(HOST);
    if (host) host.remove();
  });

  it("passes when the same DOM node is returned on both calls", () => {
    const host = setupHost();
    const node = document.createElement("input");
    node.dataset.testid = "stable";
    host.appendChild(node);

    const stable = expectNodeStable(
      () => host.querySelector<HTMLInputElement>('[data-testid="stable"]')!,
    );

    // Mutate an attribute — same node reference must persist.
    node.value = "mutated";

    expect(() => stable.assertStillSame()).not.toThrow();
    expect(stable.initial).toBe(node);
  });

  it("fails with an unmount/remount message when the node is replaced", () => {
    const host = setupHost();
    const first = document.createElement("input");
    first.dataset.testid = "swap";
    host.appendChild(first);

    const stable = expectNodeStable(
      () => host.querySelector<HTMLInputElement>('[data-testid="swap"]')!,
    );

    // Simulate a re-render that unmounts and replaces the element.
    first.remove();
    const second = document.createElement("input");
    second.dataset.testid = "swap";
    host.appendChild(second);

    expect(() => stable.assertStillSame("editor")).toThrowError(
      /DOM node identity changed/,
    );
    expect(() => stable.assertStillSame("editor")).toThrowError(/editor/);
  });

  it("fails clearly when the node disappears entirely", () => {
    const host = setupHost();
    const node = document.createElement("button");
    node.dataset.testid = "vanish";
    host.appendChild(node);

    const stable = expectNodeStable(() => {
      const found = host.querySelector<HTMLButtonElement>(
        '[data-testid="vanish"]',
      );
      if (!found) throw new Error("not found");
      return found;
    });

    node.remove();

    expect(() => stable.assertStillSame()).toThrowError(/unmounted/);
  });

  it("throws synchronously when the getter returns a falsy value at capture time", () => {
    setupHost();
    expect(() =>
      expectNodeStable(() => null as unknown as Element),
    ).toThrowError(/falsy value at capture time/);
  });
});
