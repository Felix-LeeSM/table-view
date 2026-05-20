// Sprint 350 (2026-05-15) — Tracer: MongoStructurePanel sub-sub-tab bar.
//
// 작성 이유: 본 sprint 가 Mongo Structure pane 의 sub-sub-tab bar
// (Indexes / Validator) 를 도입한다. 본 spec 의 AC-350-02 / 04 를 가드:
// (a) `role="tablist"` + 두 개의 `role="tab"`, (b) Indexes 가 기본 선택,
// (c) 마우스 클릭과 ArrowLeft/Right keyboard 으로 토글, (d) 토글 후 inner
// selection 이 Structure tab 재활성화 후에도 유지되는지 (Validator panel
// state 보존은 sprint scope 외이므로 component 가 unmount 되지 않는지로
// 가드), (e) Validator sub-sub-tab 이 `validator-panel` testid 를 mount.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
import { MongoStructurePanel } from "../MongoStructurePanel";

const listMongoIndexesMock = vi.fn();
const getMongoValidatorMock = vi.fn();
const setMongoValidatorMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    listMongoIndexes: (...args: unknown[]) => listMongoIndexesMock(...args),
    getMongoValidator: (...args: unknown[]) => getMongoValidatorMock(...args),
    setMongoValidator: (...args: unknown[]) => setMongoValidatorMock(...args),
  });
});

describe("MongoStructurePanel (Sprint 350 — tracer Indexes/Validator shell)", () => {
  beforeEach(() => {
    listMongoIndexesMock.mockReset();
    listMongoIndexesMock.mockResolvedValue([]);
    getMongoValidatorMock.mockReset();
    getMongoValidatorMock.mockResolvedValue(null);
    setMongoValidatorMock.mockReset();
    cleanup();
  });

  it("renders a sub-sub-tab bar with Indexes selected by default", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const tablist = screen.getByTestId("mongo-structure-subsubtab-bar");
    expect(tablist).toHaveAttribute("role", "tablist");

    const indexesTab = screen.getByRole("tab", { name: "Indexes" });
    const validatorTab = screen.getByRole("tab", { name: "Validator" });
    expect(indexesTab).toHaveAttribute("aria-selected", "true");
    expect(validatorTab).toHaveAttribute("aria-selected", "false");

    // Indexes panel mounted by default.
    expect(screen.getByTestId("mongo-indexes-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("validator-panel")).toBeNull();
  });

  it("switches to the Validator sub-sub-tab on click and mounts ValidatorPanel verbatim", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const validatorTab = screen.getByRole("tab", { name: "Validator" });
    act(() => {
      fireEvent.click(validatorTab);
    });

    expect(validatorTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // Validator surface mounts via its existing testid (component body
    // unchanged this sprint).
    expect(screen.getByTestId("validator-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("mongo-indexes-panel")).toBeNull();
  });

  it("toggles selection via ArrowRight / ArrowLeft keyboard navigation", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const indexesTab = screen.getByRole("tab", { name: "Indexes" });
    act(() => {
      fireEvent.keyDown(indexesTab, { key: "ArrowRight" });
    });
    expect(screen.getByRole("tab", { name: "Validator" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const validatorTab = screen.getByRole("tab", { name: "Validator" });
    act(() => {
      fireEvent.keyDown(validatorTab, { key: "ArrowLeft" });
    });
    expect(screen.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("manages roving tabindex so only the active tab is focusable", () => {
    render(
      <MongoStructurePanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    expect(screen.getByRole("tab", { name: "Indexes" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "Validator" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
});
