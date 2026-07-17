import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MysqlFormFields from "./MysqlFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "mysql",
    host: "localhost",
    port: 3306,
    user: "root",
    password: null,
    database: "",
    groupId: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

const inputClass = "input";
const labelClass = "label";

describe("MysqlFormFields", () => {
  it("renders MySQL defaults — user=root (NOT postgres), port=3306", () => {
    render(
      <MysqlFormFields
        draft={makeDraft()}
        onChange={vi.fn()}
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
    const port = screen.getByLabelText("Port") as HTMLInputElement;
    const user = screen.getByLabelText("User") as HTMLInputElement;
    expect(port.value).toBe("3306");
    expect(user.value).toBe("root");
    expect(user.value).not.toBe("postgres");
  });

  it("propagates database changes through onChange", () => {
    const onChange = vi.fn();
    render(
      <MysqlFormFields
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
      fireEvent.change(screen.getByLabelText("Database") as HTMLInputElement, {
        target: { value: "myapp" },
      });
    });
    expect(onChange).toHaveBeenCalledWith({ database: "myapp" });
  });

  // Issue #1063 — MySQL/MariaDB's TLS backend was wired in #1062 but the form
  // had no control, so the posture was unreachable. It now exposes the same
  // sslmode dropdown as PG.
  describe("sslmode dropdown (#1063)", () => {
    function renderMysql(
      overrides: Partial<ConnectionDraft>,
      onChange = vi.fn(),
    ) {
      render(
        <MysqlFormFields
          draft={makeDraft(overrides)}
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
      return onChange;
    }

    it("renders the sslmode dropdown defaulting to Prefer", () => {
      renderMysql({});
      expect(screen.getByLabelText("SSL mode")).toHaveTextContent(/Prefer/);
    });

    it("maps a Verify full selection onto encrypt + verify", async () => {
      const user = userEvent.setup();
      const onChange = renderMysql({});
      await user.click(screen.getByLabelText("SSL mode"));
      await user.click(screen.getByRole("option", { name: /Verify full/ }));
      expect(onChange).toHaveBeenCalledWith({
        tlsEnabled: true,
        trustServerCertificate: false,
      });
    });
  });
});
