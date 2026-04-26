import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PgFormFields from "./PgFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: null,
    database: "postgres",
    group_id: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("PgFormFields", () => {
  it("renders host, port, user, password, and database fields with PG defaults", () => {
    const onChange = vi.fn();
    const setPasswordInput = vi.fn();
    const setClearPassword = vi.fn();
    render(
      <PgFormFields
        draft={makeDraft()}
        onChange={onChange}
        passwordInput=""
        setPasswordInput={setPasswordInput}
        isEditing={false}
        hadPassword={false}
        clearPassword={false}
        setClearPassword={setClearPassword}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );

    const host = screen.getByLabelText("Host") as HTMLInputElement;
    const port = screen.getByLabelText("Port") as HTMLInputElement;
    const user = screen.getByLabelText("User") as HTMLInputElement;
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    const database = screen.getByLabelText("Database") as HTMLInputElement;

    expect(host.value).toBe("localhost");
    expect(port.value).toBe("5432");
    expect(user.value).toBe("postgres");
    expect(password).toBeInTheDocument();
    expect(database.value).toBe("postgres");
    // PG default user is "postgres" — explicit anti-regression.
    expect(user.value).toBe("postgres");
  });

  it("propagates host changes through onChange", () => {
    const onChange = vi.fn();
    render(
      <PgFormFields
        draft={makeDraft()}
        onChange={onChange}
        passwordInput=""
        setPasswordInput={vi.fn()}
        isEditing={false}
        hadPassword={false}
        clearPassword={false}
        setClearPassword={vi.fn()}
        inputClass={inputClass}
        labelClass={labelClass}
      />,
    );

    act(() => {
      fireEvent.change(screen.getByLabelText("Host") as HTMLInputElement, {
        target: { value: "db.example.com" },
      });
    });
    expect(onChange).toHaveBeenCalledWith({ host: "db.example.com" });
  });
});
