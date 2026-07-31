import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionDraft } from "@/types/connection";
import MssqlFormFields from "./MssqlFormFields";

// Purpose: #1063 — SQL Server defaults to trust=true (encrypt-by-default), an
// encrypted-but-unverified posture that is easy to keep by accident. The form
// must warn while that posture is active. (2026-07-17)
function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "mssql",
    host: "localhost",
    port: 1433,
    user: "sa",
    password: null,
    database: "master",
    groupId: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

function renderMssql(overrides: Partial<ConnectionDraft> = {}) {
  render(
    <MssqlFormFields
      draft={makeDraft(overrides)}
      onChange={vi.fn()}
      passwordInput=""
      setPasswordInput={vi.fn()}
      isEditing={false}
      hadPassword={false}
      clearPassword={false}
      setClearPassword={vi.fn()}
      inputClass="input"
      labelClass="label"
    />,
  );
}

describe("MssqlFormFields trust warning (#1063)", () => {
  it("warns while the default trust=true (skip-verify) posture is active", () => {
    renderMssql({ tlsEnabled: true, trustServerCertificate: true });
    expect(
      screen.getByText(/Certificate verification is skipped/),
    ).toBeInTheDocument();
  });

  it("does not warn when the certificate is verified (trust=false)", () => {
    renderMssql({ tlsEnabled: true, trustServerCertificate: false });
    expect(
      screen.queryByText(/Certificate verification is skipped/),
    ).not.toBeInTheDocument();
  });

  it("does not warn when TLS is off", () => {
    renderMssql({ tlsEnabled: false, trustServerCertificate: true });
    expect(
      screen.queryByText(/Certificate verification is skipped/),
    ).not.toBeInTheDocument();
  });
});
