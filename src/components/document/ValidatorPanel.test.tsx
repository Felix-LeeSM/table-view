// Sprint 333 (2026-05-15) — Slice K live wire. ValidatorPanel 이
// `getMongoValidator` / `setMongoValidator` 를 호출하고 raw JSON 에디터
// 를 통해 collMod 호출까지 wire-up 된다.
//
// 작성 이유: 본 sprint 가 Sprint 327 placeholder 를 실 fetch + collMod
// dispatch 로 교체한다. (a) get 호출 인자, (b) 기존 validator JSON 으로
// 에디터 초기화, (c) edit + Save → setMongoValidator 호출 인자, (d) Clear
// → setMongoValidator(null), (e) error surfaces, (f) invalid JSON 가드.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ValidatorPanel } from "./ValidatorPanel";

const getMongoValidatorMock = vi.fn();
const setMongoValidatorMock = vi.fn();

vi.mock("@/lib/tauri", () => ({
  getMongoValidator: (...args: unknown[]) => getMongoValidatorMock(...args),
  setMongoValidator: (...args: unknown[]) => setMongoValidatorMock(...args),
}));

describe("ValidatorPanel (Sprint 333 — Slice K live wire)", () => {
  beforeEach(() => {
    getMongoValidatorMock.mockReset();
    setMongoValidatorMock.mockReset();
  });

  it("initialises the editor with the validator JSON returned by the backend", async () => {
    getMongoValidatorMock.mockResolvedValueOnce({
      $jsonSchema: { bsonType: "object", required: ["name"] },
    });

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    await waitFor(() => {
      expect(getMongoValidatorMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
      );
    });

    const editor = await screen.findByTestId("validator-panel-editor");
    expect(editor).toHaveValue(
      JSON.stringify(
        { $jsonSchema: { bsonType: "object", required: ["name"] } },
        null,
        2,
      ),
    );
  });

  it("renders an empty editor when the collection has no validator", async () => {
    getMongoValidatorMock.mockResolvedValueOnce(null);

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="empty_coll"
      />,
    );

    await waitFor(() => {
      expect(getMongoValidatorMock).toHaveBeenCalled();
    });

    const editor = screen.getByTestId("validator-panel-editor");
    expect(editor).toHaveValue("");
  });

  it("dispatches collMod with the parsed JSON when the user clicks Save", async () => {
    getMongoValidatorMock.mockResolvedValueOnce(null);
    setMongoValidatorMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const editor = await screen.findByTestId("validator-panel-editor");
    const next = '{"$jsonSchema":{"bsonType":"object"}}';
    fireEvent.change(editor, { target: { value: next } });

    await user.click(screen.getByTestId("validator-panel-save"));

    await waitFor(() => {
      expect(setMongoValidatorMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        { $jsonSchema: { bsonType: "object" } },
      );
    });
  });

  it("blocks Save and surfaces a parse error when the JSON is invalid", async () => {
    getMongoValidatorMock.mockResolvedValueOnce(null);
    const user = userEvent.setup();

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    const editor = await screen.findByTestId("validator-panel-editor");
    fireEvent.change(editor, { target: { value: "{not json" } });

    await user.click(screen.getByTestId("validator-panel-save"));

    expect(
      await screen.findByTestId("validator-panel-save-error"),
    ).toHaveTextContent(/invalid json/i);
    expect(setMongoValidatorMock).not.toHaveBeenCalled();
  });

  it("clears the validator with a null payload when Clear is clicked", async () => {
    getMongoValidatorMock.mockResolvedValueOnce({ $jsonSchema: {} });
    setMongoValidatorMock.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    await screen.findByTestId("validator-panel-editor");

    await user.click(screen.getByTestId("validator-panel-clear"));

    await waitFor(() => {
      expect(setMongoValidatorMock).toHaveBeenCalledWith(
        "conn-mongo",
        "app",
        "users",
        null,
      );
    });
  });

  it("surfaces fetch errors via role=alert", async () => {
    getMongoValidatorMock.mockRejectedValueOnce(new Error("permission denied"));

    render(
      <ValidatorPanel
        connectionId="conn-mongo"
        database="app"
        collection="users"
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /permission denied/i,
    );
  });
});
