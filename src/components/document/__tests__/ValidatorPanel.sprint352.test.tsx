// Sprint 352 (2026-05-15) — Mongo validator level/action 토글 확장.
//
// 작성 이유: 본 sprint 가 ValidatorPanel 에 `validationLevel` + `validationAction`
// select 컨트롤을 추가했다. AC-352-03 (4 시나리오) + AC-352-04 (backward-compat)
// 를 직접 단언한다. Sprint 333 기존 6 테스트는 `ValidatorPanel.test.tsx` 에 그대로
// 유지된다.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValidatorPanel } from "../ValidatorPanel";

const getMongoValidatorMock = vi.fn();
const setMongoValidatorMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    getMongoValidator: (...args: unknown[]) => getMongoValidatorMock(...args),
    setMongoValidator: (...args: unknown[]) => setMongoValidatorMock(...args),
  });
});

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

    const levelSelect = await screen.findByTestId("validator-level-select");
    const actionSelect = await screen.findByTestId("validator-action-select");

    await waitFor(() => {
      expect(levelSelect).toHaveValue("moderate");
      expect(actionSelect).toHaveValue("warn");
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
    await screen.findByTestId("validator-level-select");

    // Flip both selects to the moderate + warn migration pattern.
    fireEvent.change(screen.getByTestId("validator-level-select"), {
      target: { value: "moderate" },
    });
    fireEvent.change(screen.getByTestId("validator-action-select"), {
      target: { value: "warn" },
    });

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

    const levelSelect = await screen.findByTestId("validator-level-select");
    const actionSelect = screen.getByTestId("validator-action-select");

    expect(actionSelect).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByTestId("validator-action-disabled-hint"),
    ).not.toBeInTheDocument();

    fireEvent.change(levelSelect, { target: { value: "off" } });

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

    await screen.findByTestId("validator-level-select");

    fireEvent.change(screen.getByTestId("validator-level-select"), {
      target: { value: "moderate" },
    });

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

    const levelSelect = await screen.findByTestId("validator-level-select");
    const actionSelect = await screen.findByTestId("validator-action-select");

    await waitFor(() => {
      expect(levelSelect).toHaveValue("strict");
      expect(actionSelect).toHaveValue("error");
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

    const levelSelect = await screen.findByTestId("validator-level-select");
    const actionSelect = await screen.findByTestId("validator-action-select");

    await waitFor(() => {
      expect(levelSelect).toHaveValue("strict");
      expect(actionSelect).toHaveValue("error");
    });
    expect(screen.getByTestId("validator-panel-editor")).toHaveValue("");
  });
});
