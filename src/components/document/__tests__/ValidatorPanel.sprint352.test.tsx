// Sprint 352 (2026-05-15) — Mongo validator level/action 토글 확장.
//
// 작성 이유: 본 sprint 가 ValidatorPanel 에 `validationLevel` + `validationAction`
// select 컨트롤을 추가했다. AC-352-03 (4 시나리오) + AC-352-04 (backward-compat)
// 를 직접 단언한다. Sprint 333 기존 6 테스트는 `ValidatorPanel.test.tsx` 에 그대로
// 유지된다.
//
// #1791 (2026-08-01) — 두 컨트롤이 native `<select>` 에서 Radix `<Select>` 로
// 옮겨갔다. Radix 는 trigger 버튼(role="combobox") + portal listbox 라
// `fireEvent.change` / `toHaveValue` 가 닿지 않는다. 조회는 role + aria-label,
// 선택은 trigger 클릭 → `role="option"` 클릭, 현재 값 단언은 trigger 의 텍스트다.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { ValidatorPanel } from "../ValidatorPanel";

const getMongoValidatorMock = vi.fn();
const setMongoValidatorMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    getMongoValidator: (...args: unknown[]) => getMongoValidatorMock(...args),
    setMongoValidator: (...args: unknown[]) => setMongoValidatorMock(...args),
  });
});

const LEVEL_TRIGGER = "Validation level";
const ACTION_TRIGGER = "Validation action";

/** Open a Radix `<Select>` by its trigger accessible name and click one of the
 *  portaled options. Replaces the `fireEvent.change` the native `<select>` took. */
async function pickOption(triggerName: string, optionName: string) {
  fireEvent.click(screen.getByRole("combobox", { name: triggerName }));
  fireEvent.click(await screen.findByRole("option", { name: optionName }));
}

describe("ValidatorPanel — Sprint 352 (level + action toggles)", () => {
  beforeEach(() => {
    getMongoValidatorMock.mockReset();
    setMongoValidatorMock.mockReset();
  });

  it("AC-352-03 — hydrates level + action selects from the read response on mount", async () => {
    // Sprint 352 envelope shape — backend returns the trio together.
    getMongoValidatorMock.mockResolvedValueOnce({
      validator: { $jsonSchema: { bsonType: "object" } },
      validationLevel: "moderate",
      validationAction: "warn",
    });

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const levelSelect = await screen.findByRole("combobox", {
      name: LEVEL_TRIGGER,
    });
    const actionSelect = screen.getByRole("combobox", { name: ACTION_TRIGGER });

    await waitFor(() => {
      expect(levelSelect).toHaveTextContent("moderate");
      expect(actionSelect).toHaveTextContent("warn");
    });
  });

  it("AC-352-03 — Save round-trips the current level + action choice", async () => {
    getMongoValidatorMock.mockResolvedValueOnce({
      validator: null,
      validationLevel: "strict",
      validationAction: "error",
    });
    setMongoValidatorMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    // Wait for initial hydration so the dirty-check baseline is captured.
    await screen.findByRole("combobox", { name: LEVEL_TRIGGER });

    // Flip both selects to the moderate + warn migration pattern.
    await pickOption(LEVEL_TRIGGER, "moderate");
    await pickOption(ACTION_TRIGGER, "warn");

    // Editing only the selects must enable Save — the dirty check covers
    // select changes per AC-352-03.
    const saveBtn = screen.getByTestId("validator-panel-save");
    await waitFor(() => expect(saveBtn).not.toBeDisabled());

    // Also drop a validator JSON to exercise the full payload shape.
    const editor = screen.getByTestId("validator-panel-editor");
    fireEvent.change(editor, {
      target: { value: '{"$jsonSchema":{"bsonType":"object"}}' },
    });

    await user.click(saveBtn);

    await waitFor(() => {
      expect(setMongoValidatorMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        { $jsonSchema: { bsonType: "object" } },
        "moderate",
        "warn",
      );
    });
  });

  it("AC-352-03 — selecting level=off disables the action select with aria-disabled and an inline hint", async () => {
    getMongoValidatorMock.mockResolvedValueOnce({
      validator: null,
      validationLevel: "strict",
      validationAction: "error",
    });

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    await screen.findByRole("combobox", { name: LEVEL_TRIGGER });
    const actionSelect = screen.getByRole("combobox", { name: ACTION_TRIGGER });

    expect(actionSelect).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByTestId("validator-action-disabled-hint"),
    ).not.toBeInTheDocument();

    await pickOption(LEVEL_TRIGGER, "off");

    expect(actionSelect).toHaveAttribute("aria-disabled", "true");
    expect(actionSelect).toBeDisabled();
    expect(
      screen.getByTestId("validator-action-disabled-hint"),
    ).toHaveTextContent(/action has no effect when level is off/i);
  });

  it("AC-352-03 — after Save the dirty baseline resets so Save disables until further edits", async () => {
    getMongoValidatorMock.mockResolvedValueOnce({
      validator: null,
      validationLevel: "strict",
      validationAction: "error",
    });
    setMongoValidatorMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    await screen.findByRole("combobox", { name: LEVEL_TRIGGER });

    await pickOption(LEVEL_TRIGGER, "moderate");

    const saveBtn = screen.getByTestId("validator-panel-save");
    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    await user.click(saveBtn);

    // After a successful Save, the originals catch up to the new value
    // so Save re-disables until the user makes another change.
    await waitFor(() => {
      expect(setMongoValidatorMock).toHaveBeenCalled();
      expect(saveBtn).toBeDisabled();
    });
  });

  it("AC-352-04 — backward-compat: legacy `{ validator }` response falls back to MongoDB defaults", async () => {
    // The pre-Sprint-352 backend / a partial stub returns the legacy
    // envelope (no level/action keys). The panel must not crash and the
    // selects must hydrate to MongoDB's server-side defaults (strict /
    // error).
    getMongoValidatorMock.mockResolvedValueOnce({
      validator: { $jsonSchema: {} },
    });

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const levelSelect = await screen.findByRole("combobox", {
      name: LEVEL_TRIGGER,
    });
    const actionSelect = screen.getByRole("combobox", { name: ACTION_TRIGGER });

    await waitFor(() => {
      expect(levelSelect).toHaveTextContent("strict");
      expect(actionSelect).toHaveTextContent("error");
    });
    // The editor still hydrates with the validator JSON the legacy
    // backend returned.
    expect(screen.getByTestId("validator-panel-editor")).toHaveValue(
      JSON.stringify({ $jsonSchema: {} }, null, 2),
    );
  });

  it("AC-352-04 — backward-compat: pre-envelope `null` response keeps the selects at defaults without crashing", async () => {
    getMongoValidatorMock.mockResolvedValueOnce(null);

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const levelSelect = await screen.findByRole("combobox", {
      name: LEVEL_TRIGGER,
    });
    const actionSelect = screen.getByRole("combobox", { name: ACTION_TRIGGER });

    await waitFor(() => {
      expect(levelSelect).toHaveTextContent("strict");
      expect(actionSelect).toHaveTextContent("error");
    });
    expect(screen.getByTestId("validator-panel-editor")).toHaveValue("");
  });

  // #1791 — the native `<select>` gave keyboard operation for free; the Radix
  // trigger has to keep it. Drive the level control with the keyboard only and
  // assert the choice reaches the collMod payload.
  it("#1791 — level is selectable by keyboard alone and reaches the Save payload", async () => {
    getMongoValidatorMock.mockResolvedValueOnce({
      validator: null,
      validationLevel: "off",
      validationAction: "error",
    });
    setMongoValidatorMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const levelSelect = await screen.findByRole("combobox", {
      name: LEVEL_TRIGGER,
    });
    await waitFor(() => expect(levelSelect).toHaveTextContent("off"));

    levelSelect.focus();
    // ArrowDown on the trigger opens the listbox with the current value
    // focused; the next ArrowDown walks to `strict` and Enter commits it.
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("listbox");
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(levelSelect).toHaveTextContent("strict"));

    await user.click(screen.getByTestId("validator-panel-save"));

    await waitFor(() => {
      expect(setMongoValidatorMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        null,
        "strict",
        "error",
      );
    });
  });

  // #1791 — the sprint-112 rule the eslint guard encodes: this surface must not
  // fall back to a native `<select>`. Fails RED the moment one is reintroduced.
  it("#1791 — renders no native <select> (sprint-112 normalize)", async () => {
    getMongoValidatorMock.mockResolvedValueOnce(null);

    const { container } = render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    await screen.findByRole("combobox", { name: LEVEL_TRIGGER });
    expect(container.querySelector("select")).toBeNull();
  });
});
