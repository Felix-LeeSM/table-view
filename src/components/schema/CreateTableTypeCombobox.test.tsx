// Sprint 227 — `CreateTableTypeCombobox` test suite (Phase 27 sprint 2).
//
// Date: 2026-05-06.
//
// Why this file exists:
// - Locks AC-227-03 (filter behaviour, Enter commits highlighted
//   suggestion, free-text fallback on blur).
// - Decouples combobox-only assertions from the modal-level tests so
//   the modal suite can stay focused on tab/preview/IPC orchestration.
import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import CreateTableTypeCombobox from "./CreateTableTypeCombobox";

/**
 * The combobox is fully controlled — wrap it in a tiny React host so
 * `value` reflects every keystroke. `onChangeSpy` is forwarded so
 * tests can assert the commit value directly.
 */
function ControlledHost({
  onChangeSpy,
}: {
  onChangeSpy?: (next: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <CreateTableTypeCombobox
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
    />
  );
}

describe("CreateTableTypeCombobox (Sprint 227 — AC-227-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("typing 'int' filters to integer/bigint/smallint/interval (case-insensitive substring)", async () => {
    render(<ControlledHost />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "int" } });

    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    expect(listbox).toBeInTheDocument();
    const options = listbox.querySelectorAll('[role="option"]');
    const labels = Array.from(options).map((o) => o.textContent ?? "");
    for (const expected of ["integer", "bigint", "smallint", "interval"]) {
      expect(labels).toContain(expected);
    }
    // Sanity: every visible option contains the substring.
    for (const label of labels) {
      expect(label.toLowerCase()).toContain("int");
    }
  });

  it("Enter commits the highlighted suggestion", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "uuid" } });

    await waitFor(() => {
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
    fireEvent.keyDown(input, { key: "Enter" });
    // The first (and only) filtered match for "uuid" is "uuid"; the
    // last `onChange` value committed is the suggestion verbatim.
    expect(spy).toHaveBeenLastCalledWith("uuid");
  });

  it("ArrowDown moves the highlight to the next suggestion", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "int" } });

    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    // Filtered list for `int` is ordered as it appears in the canonical
    // list: integer, bigint, smallint, interval. Press ArrowDown twice
    // → highlight = 2 → Enter commits "smallint".
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(spy).toHaveBeenLastCalledWith("smallint");
  });

  it("Escape closes the popover without committing a suggestion", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "int" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    // The keystroke onChange already fired with "int" before Escape.
    // No additional commit should fire after Escape.
    expect(spy).toHaveBeenLastCalledWith("int");
  });

  it("free-text fallback — 'numeric(10,4)' commits the raw value verbatim (AC-227-03)", () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "numeric(10,4)" } });
    fireEvent.blur(input);

    // The last `onChange` is the raw keystroke — `numeric(10,4)` —
    // and no further `onChange` fires on blur (the parent already
    // owns the verbatim string).
    expect(spy).toHaveBeenLastCalledWith("numeric(10,4)");
  });

  it("clicking a suggestion commits the value (AC-227-03)", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "uu" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const uuidOption = screen.getByRole("option", { name: "uuid" });
    fireEvent.mouseDown(uuidOption);
    expect(spy).toHaveBeenLastCalledWith("uuid");
  });

  // Sprint 227 hot-fix (2026-05-07): the combobox should open the
  // suggestion list as soon as the user focuses the input, even with
  // an empty value, so the user discovers the picker without having
  // to know the ArrowDown / chevron-click affordance up front.
  it("auto-opens the listbox on focus (empty value shows full canonical list)", async () => {
    render(<ControlledHost />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    const options = listbox.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThanOrEqual(25);
    // canonical entries surface verbatim
    const labels = Array.from(options).map((o) => o.textContent ?? "");
    expect(labels).toContain("uuid");
    expect(labels).toContain("text");
  });

  // Sprint 227 hot-fix (2026-05-07): the chevron button must be
  // clickable — it toggles the popover and re-focuses the input. The
  // pre-fix combobox rendered a `pointer-events-none` chevron which
  // was visually misleading.
  it("clicking the chevron toggles the listbox (AC-227-03 follow-up)", async () => {
    render(<ControlledHost />);
    const chevron = screen.getByRole("button", { name: "Show types" });
    fireEvent.mouseDown(chevron);
    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    expect(listbox).toBeInTheDocument();
    fireEvent.mouseDown(chevron);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  // Sprint 227 hot-fix (2026-05-07): bare parametric types
  // auto-expand to a canonical default — `varchar` → `varchar(255)`,
  // `char` → `char(1)`, `numeric` → `numeric(10,2)` — so the user
  // doesn't have to remember the parameter syntax. Free-text override
  // still works (covered by the `numeric(10,4)` blur case).
  it("selecting bare 'varchar' auto-expands to 'varchar(255)'", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "varchar" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    // Filter for "varchar" surfaces both `varchar` and `varchar(255)`.
    // First match is the bare `varchar`; Enter commits and expands.
    const bareOption = screen.getByRole("option", { name: "varchar" });
    fireEvent.mouseDown(bareOption);
    expect(spy).toHaveBeenLastCalledWith("varchar(255)");
  });

  it("selecting bare 'char' auto-expands to 'char(1)'", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "char" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const bareOption = screen.getByRole("option", { name: "char" });
    fireEvent.mouseDown(bareOption);
    expect(spy).toHaveBeenLastCalledWith("char(1)");
  });

  it("selecting bare 'numeric' auto-expands to 'numeric(10,2)'", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "numeric" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const bareOption = screen.getByRole("option", { name: "numeric" });
    fireEvent.mouseDown(bareOption);
    expect(spy).toHaveBeenLastCalledWith("numeric(10,2)");
  });

  it("selecting an already-parametric type ('varchar(255)') is idempotent", async () => {
    const spy = vi.fn();
    render(<ControlledHost onChangeSpy={spy} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "varchar(2" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const fullOption = screen.getByRole("option", { name: "varchar(255)" });
    fireEvent.mouseDown(fullOption);
    expect(spy).toHaveBeenLastCalledWith("varchar(255)");
  });
});

describe("CreateTableTypeCombobox (Sprint 230 — typesSource prop)", () => {
  function ControlledHostWithSource({
    typesSource,
    onChangeSpy,
  }: {
    typesSource?: string[];
    onChangeSpy?: (next: string) => void;
  }) {
    const [value, setValue] = useState("");
    return (
      <CreateTableTypeCombobox
        value={value}
        typesSource={typesSource}
        onChange={(next) => {
          setValue(next);
          onChangeSpy?.(next);
        }}
      />
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Sprint 230 — when `typesSource` is provided, the combobox filters
  // the dynamic list rather than the canonical `POSTGRES_COMMON_TYPES`.
  it("typesSource={...} filters the dynamic list (geo → geometry, varchar excluded)", async () => {
    const dynamic = ["geometry", "public.my_enum", "varchar", "uuid"];
    render(<ControlledHostWithSource typesSource={dynamic} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "geo" } });

    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent ?? "",
    );
    expect(labels).toContain("geometry");
    expect(labels).not.toContain("varchar");
    expect(labels).not.toContain("uuid");
  });

  // Sprint 230 — when `typesSource` is omitted (back-compat), the
  // combobox falls back to the canonical list path.
  it("typesSource omitted — canonical list path is used (back-compat)", async () => {
    render(<ControlledHostWithSource />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "int" } });

    const listbox = await screen.findByRole("listbox", {
      name: /PostgreSQL types/i,
    });
    const labels = Array.from(listbox.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent ?? "",
    );
    for (const expected of ["integer", "bigint", "smallint", "interval"]) {
      expect(labels).toContain(expected);
    }
  });

  // Sprint 230 — `expandParametricDefault` parity with the dynamic
  // list. Bare `varchar` MUST still expand to `varchar(255)` because
  // canonical types are guaranteed-present in the merged head.
  it("parametric default expansion intact when canonical bare 'varchar' is in the dynamic list (AC-230-09)", async () => {
    const spy = vi.fn();
    const dynamic = ["varchar", "varchar(255)", "geometry", "public.my_enum"];
    render(
      <ControlledHostWithSource typesSource={dynamic} onChangeSpy={spy} />,
    );
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "var" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const bareOption = screen.getByRole("option", { name: "varchar" });
    fireEvent.mouseDown(bareOption);
    expect(spy).toHaveBeenLastCalledWith("varchar(255)");
  });

  // Sprint 230 — `geometry` is non-parametric in the dynamic list, so
  // committing it forwards the value verbatim.
  it("non-parametric dynamic entry (geometry) commits verbatim", async () => {
    const spy = vi.fn();
    const dynamic = ["geometry", "public.my_enum"];
    render(
      <ControlledHostWithSource typesSource={dynamic} onChangeSpy={spy} />,
    );
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "geo" } });
    await waitFor(() =>
      expect(screen.getByRole("listbox")).toBeInTheDocument(),
    );
    const opt = screen.getByRole("option", { name: "geometry" });
    fireEvent.mouseDown(opt);
    expect(spy).toHaveBeenLastCalledWith("geometry");
  });
});

// Sprint 234 — `typeKindMap` color-dot rendering (Phase 27 sprint 9).
//
// Date: 2026-05-07.
//
// Why this block exists:
// - Locks AC-234-08 (color dot per `type_kind`) — `enum` blue, `domain`
//   green, `range` purple, `composite` orange. `base` and unknown kinds
//   render NO dot (graceful degrade — never throw).
// - Confirms back-compat: when `typeKindMap` is omitted, no dots render
//   regardless of the suggestion list.

describe("CreateTableTypeCombobox (Sprint 234 — typeKindMap color dots)", () => {
  function ControlledHostWithKindMap({
    typesSource,
    typeKindMap,
  }: {
    typesSource?: string[];
    typeKindMap?: Map<string, string>;
  }) {
    const [value, setValue] = useState("");
    return (
      <CreateTableTypeCombobox
        value={value}
        typesSource={typesSource}
        typeKindMap={typeKindMap}
        onChange={setValue}
      />
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Sprint 234 AC-234-08 — enum kinds render a blue dot.
  it("renders a blue dot prefix for enum-typed options when typeKindMap supplies enum (AC-234-08)", async () => {
    const dynamic = ["public.my_enum", "uuid"];
    const kindMap = new Map<string, string>([
      ["public.my_enum", "enum"],
      ["uuid", "base"],
    ]);
    render(
      <ControlledHostWithKindMap typesSource={dynamic} typeKindMap={kindMap} />,
    );
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);

    const enumOption = await screen.findByRole("option", {
      name: "public.my_enum",
    });
    const dot = enumOption.querySelector('[data-testid="type-kind-dot"]');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("class")).toContain("text-typekind-enum");
    // Accessible name stays the verbatim type label (no dot character
    // injected because the span is `aria-hidden`).
    expect(
      enumOption.getAttribute("aria-label") ?? enumOption.textContent,
    ).toContain("public.my_enum");
  });

  // Sprint 234 AC-234-08 — domain (green), range (purple), composite (orange).
  it("renders a green dot for domain, purple for range, orange for composite (AC-234-08)", async () => {
    const dynamic = ["public.my_domain", "public.my_range", "public.my_comp"];
    const kindMap = new Map<string, string>([
      ["public.my_domain", "domain"],
      ["public.my_range", "range"],
      ["public.my_comp", "composite"],
    ]);
    render(
      <ControlledHostWithKindMap typesSource={dynamic} typeKindMap={kindMap} />,
    );
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);

    const domainOpt = await screen.findByRole("option", {
      name: "public.my_domain",
    });
    expect(
      domainOpt
        .querySelector('[data-testid="type-kind-dot"]')
        ?.getAttribute("class"),
    ).toContain("text-typekind-domain");

    const rangeOpt = screen.getByRole("option", {
      name: "public.my_range",
    });
    expect(
      rangeOpt
        .querySelector('[data-testid="type-kind-dot"]')
        ?.getAttribute("class"),
    ).toContain("text-typekind-range");

    const compOpt = screen.getByRole("option", {
      name: "public.my_comp",
    });
    expect(
      compOpt
        .querySelector('[data-testid="type-kind-dot"]')
        ?.getAttribute("class"),
    ).toContain("text-typekind-composite");
  });

  // Sprint 234 AC-234-08 — `base` kind omits the dot (no DOM noise).
  it("omits the dot for base-kind options (AC-234-08)", async () => {
    const dynamic = ["uuid"];
    const kindMap = new Map<string, string>([["uuid", "base"]]);
    render(
      <ControlledHostWithKindMap typesSource={dynamic} typeKindMap={kindMap} />,
    );
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);

    const opt = await screen.findByRole("option", { name: "uuid" });
    expect(opt.querySelector('[data-testid="type-kind-dot"]')).toBeNull();
  });

  // Sprint 234 AC-234-08 — back-compat: omitting `typeKindMap` renders
  // identically to Sprint 230 (no dots regardless of suggestion list).
  it("omits the dot when typeKindMap is undefined (back-compat) (AC-234-08)", async () => {
    const dynamic = ["public.my_enum", "uuid"];
    render(<ControlledHostWithKindMap typesSource={dynamic} />);
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);

    const enumOpt = await screen.findByRole("option", {
      name: "public.my_enum",
    });
    expect(enumOpt.querySelector('[data-testid="type-kind-dot"]')).toBeNull();
    const uuidOpt = screen.getByRole("option", { name: "uuid" });
    expect(uuidOpt.querySelector('[data-testid="type-kind-dot"]')).toBeNull();
  });

  // Sprint 234 — unknown kind degrades gracefully (no throw, no dot).
  it("unknown kind in typeKindMap renders no dot (graceful degrade) (AC-234-08)", async () => {
    const dynamic = ["public.future_kind"];
    const kindMap = new Map<string, string>([
      ["public.future_kind", "multirange"], // hypothetical PG 17 kind
    ]);
    render(
      <ControlledHostWithKindMap typesSource={dynamic} typeKindMap={kindMap} />,
    );
    const input = screen.getByRole("combobox", { name: "Column data type" });
    fireEvent.focus(input);

    const opt = await screen.findByRole("option", {
      name: "public.future_kind",
    });
    expect(opt.querySelector('[data-testid="type-kind-dot"]')).toBeNull();
  });
});
