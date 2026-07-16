import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import PgFormFields from "./PgFormFields";
import type { ConnectionDraft } from "@/types/connection";

function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: null,
    database: "postgres",
    groupId: null,
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

  // #1526 / #1062 — PG routes through the same `resolve_tls_decision` trust
  // boundary as MSSQL: enabling TLS with `trust=None` is hard-rejected by the
  // backend. These lock that the form can never emit that invalid combo.
  describe("TLS toggles (#1526)", () => {
    function renderPg(draft: Partial<ConnectionDraft>, onChange = vi.fn()) {
      render(
        <PgFormFields
          draft={makeDraft(draft)}
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

    it("renders both toggles off by default (localhost dev keeps plaintext)", () => {
      renderPg({});
      const tls = screen.getByLabelText(
        "Enable encryption (TLS)",
      ) as HTMLInputElement;
      const trust = screen.getByLabelText(
        "Trust server certificate",
      ) as HTMLInputElement;
      expect(tls.checked).toBe(false);
      expect(trust.checked).toBe(false);
      // Trust is meaningless without encryption — disabled while TLS is off.
      expect(trust.disabled).toBe(true);
    });

    it("enabling TLS also seeds trust=false so the combo is valid (verify-full)", () => {
      const onChange = renderPg({});
      act(() => {
        fireEvent.click(screen.getByLabelText("Enable encryption (TLS)"));
      });
      // NOT `{ tlsEnabled: true }` alone — that would leave trust=None and the
      // backend would reject the connection with no in-form way to recover.
      expect(onChange).toHaveBeenCalledWith({
        tlsEnabled: true,
        trustServerCertificate: false,
      });
    });

    it("disabling TLS clears trust back to null (driver default)", () => {
      const onChange = renderPg({
        tlsEnabled: true,
        trustServerCertificate: false,
      });
      act(() => {
        fireEvent.click(screen.getByLabelText("Enable encryption (TLS)"));
      });
      expect(onChange).toHaveBeenCalledWith({
        tlsEnabled: false,
        trustServerCertificate: null,
      });
    });

    it("toggling trust while TLS is on skips verification (Require)", () => {
      const onChange = renderPg({
        tlsEnabled: true,
        trustServerCertificate: false,
      });
      const trust = screen.getByLabelText(
        "Trust server certificate",
      ) as HTMLInputElement;
      expect(trust.disabled).toBe(false);
      act(() => {
        fireEvent.click(trust);
      });
      expect(onChange).toHaveBeenCalledWith({ trustServerCertificate: true });
    });

    it("surfaces the downgrade hint so leaving TLS off is an explicit choice", () => {
      renderPg({});
      // #1062 core: the silent `sslmode=prefer` downgrade is made explicit in
      // the form copy rather than a runtime backend event.
      expect(screen.getByText(/sslmode=prefer/)).toBeInTheDocument();
    });
  });
});
