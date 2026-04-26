import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SqliteFormFields from "./SqliteFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    db_type: "sqlite",
    host: "",
    port: 0,
    user: "",
    password: null,
    database: "",
    group_id: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("SqliteFormFields", () => {
  it("renders the file path field and OMITS host/port/user/password", () => {
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );
    expect(
      screen.getByLabelText("SQLite database file path"),
    ).toBeInTheDocument();
    // Network/auth fields are absent.
    expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Port")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("User")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("propagates file path changes through onChange ({ database })", () => {
    const onChange = vi.fn();
    render(
      <SqliteFormFields
        draft={makeDraft()}
        onChange={onChange}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );
    act(() => {
      fireEvent.change(
        screen.getByLabelText("SQLite database file path") as HTMLInputElement,
        { target: { value: "/data/app.sqlite" } },
      );
    });
    expect(onChange).toHaveBeenCalledWith({ database: "/data/app.sqlite" });
  });
});
