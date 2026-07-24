import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import MssqlFormFields from "./MssqlFormFields";
import type { ConnectionDraft } from "@/types/connection";

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

describe("MssqlFormFields trust warning (#1649)", () => {
  it("warns while the default require (skip-verify) posture is active", () => {
    renderMssql({ sslMode: "require" });
    expect(
      screen.getByText(/Certificate verification is skipped/),
    ).toBeInTheDocument();
  });

  it("does not warn when the certificate is verified (verify-full)", () => {
    renderMssql({ sslMode: "verify-full" });
    expect(
      screen.queryByText(/Certificate verification is skipped/),
    ).not.toBeInTheDocument();
  });

  it("does not warn when TLS is off (disable/prefer)", () => {
    renderMssql({ sslMode: "disable" });
    expect(
      screen.queryByText(/Certificate verification is skipped/),
    ).not.toBeInTheDocument();
  });
});
