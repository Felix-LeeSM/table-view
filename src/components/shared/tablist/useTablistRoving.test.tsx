import { describe, it, expect, vi } from "vitest";
import { useRef, useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { useTablistRoving } from "./useTablistRoving";

const VALUES = ["one", "two", "three"] as const;
type V = (typeof VALUES)[number];

/**
 * Minimal APG-shaped tablist harness so the hook is exercised through real
 * DOM focus + roving tabindex, not a mocked event object.
 */
function Harness({ onActivate }: { onActivate?: (v: V) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<V>("one");
  const activate = (v: V) => {
    setActive(v);
    onActivate?.(v);
  };
  const { onKeyDown } = useTablistRoving([...VALUES], active, activate, ref);
  return (
    <div role="tablist" ref={ref} onKeyDown={onKeyDown}>
      {VALUES.map((v) => (
        <button
          key={v}
          role="tab"
          data-tab-value={v}
          aria-selected={active === v}
          tabIndex={active === v ? 0 : -1}
          onClick={() => activate(v)}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function tabs() {
  return screen.getAllByRole("tab");
}

describe("useTablistRoving", () => {
  it("exposes exactly one tab stop (roving tabindex)", () => {
    render(<Harness />);
    const stops = tabs().filter((t) => t.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveTextContent("one");
  });

  it("ArrowRight moves + activates the next tab, rolling tabindex", () => {
    const onActivate = vi.fn();
    render(<Harness onActivate={onActivate} />);
    tabs()[0]!.focus();
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight" });
    expect(onActivate).toHaveBeenLastCalledWith("two");
    expect(tabs()[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[1]).toHaveAttribute("tabindex", "0");
    expect(tabs()[0]).toHaveAttribute("tabindex", "-1");
    expect(tabs()[1]).toHaveFocus();
  });

  it("ArrowLeft moves + activates the previous tab", () => {
    render(<Harness />);
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowRight" });
    fireEvent.keyDown(tabs()[1]!, { key: "ArrowLeft" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[0]).toHaveFocus();
  });

  it("wraps ArrowRight past the end back to the first", () => {
    render(<Harness />);
    fireEvent.keyDown(tabs()[0]!, { key: "End" });
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tabs()[2]!, { key: "ArrowRight" });
    expect(tabs()[0]).toHaveAttribute("aria-selected", "true");
  });

  it("wraps ArrowLeft before the start to the last", () => {
    render(<Harness />);
    fireEvent.keyDown(tabs()[0]!, { key: "ArrowLeft" });
    expect(tabs()[2]).toHaveAttribute("aria-selected", "true");
    expect(tabs()[2]).toHaveFocus();
  });

  it("Home / End jump to the first / last tab", () => {
    render(<Harness />);
    fireEvent.keyDown(tabs()[0]!, { key: "End" });
    expect(tabs()[2]).toHaveFocus();
    fireEvent.keyDown(tabs()[2]!, { key: "Home" });
    expect(tabs()[0]).toHaveFocus();
  });

  it("ignores non-navigation keys", () => {
    const onActivate = vi.fn();
    render(<Harness onActivate={onActivate} />);
    fireEvent.keyDown(tabs()[0]!, { key: "a" });
    fireEvent.keyDown(tabs()[0]!, { key: "Tab" });
    expect(onActivate).not.toHaveBeenCalled();
  });
});
