// #1581 — F6 i18n regression. `OrderedColumnPicker` previously hardcoded its
// aria-labels / titles / empty-state copy in English even inside a ko session
// (`${prefix} picker`, "Move earlier", "No columns available"). This test
// renders the picker under the ko locale and asserts the scaffolding follows
// the active language, interpolating the caller-provided (localized) prefix.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@lib/i18n";
import OrderedColumnPicker from "./OrderedColumnPicker";

// The picker is a global singleton consumer of i18n — restore en so this file
// never leaks ko into sibling suites.
afterEach(async () => {
  await i18n.changeLanguage("en");
});

const KO_PREFIX = "인덱스 컬럼"; // schemaDialogs.indexesTab.columnPickerPrefix (ko)

describe("OrderedColumnPicker (ko locale — #1581)", () => {
  it("localizes the container aria, reorder titles, and add-button aria", async () => {
    await i18n.changeLanguage("ko");
    render(
      <OrderedColumnPicker
        available={["email", "id"]}
        selected={["email"]}
        onChange={vi.fn()}
        ariaLabelPrefix={KO_PREFIX}
      />,
    );

    // Container wrapper aria = "{{prefix}} 선택기".
    expect(screen.getByLabelText("인덱스 컬럼 선택기")).toBeInTheDocument();
    // Reorder button native titles.
    expect(screen.getByTitle("앞으로 이동")).toBeInTheDocument();
    expect(screen.getByTitle("뒤로 이동")).toBeInTheDocument();
    expect(screen.getByTitle("제거")).toBeInTheDocument();
    // Available chip add-button aria = "{{prefix}}: {{name}}".
    expect(screen.getByLabelText("인덱스 컬럼: id")).toBeInTheDocument();
    // Selected pill remove aria = "{{prefix}} 제거: {{name}}".
    expect(
      screen.getByLabelText("인덱스 컬럼 제거: email"),
    ).toBeInTheDocument();
  });

  it("falls back to the localized default empty-state copy", async () => {
    await i18n.changeLanguage("ko");
    render(
      <OrderedColumnPicker
        available={[]}
        selected={[]}
        onChange={vi.fn()}
        ariaLabelPrefix={KO_PREFIX}
      />,
    );
    expect(screen.getByText("사용 가능한 컬럼 없음")).toBeInTheDocument();
  });
});
