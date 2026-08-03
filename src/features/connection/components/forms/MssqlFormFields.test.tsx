import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionDraft } from "@/types/connection";
import MssqlFormFields from "./MssqlFormFields";

// Purpose: #1063 — SQL Server defaults to `require` (encrypt-by-default,
// certificate unverified), a posture that is easy to keep by accident. The form
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
  const onChange = vi.fn();
  const fields = (draft: Partial<ConnectionDraft>) => (
    <MssqlFormFields
      draft={makeDraft(draft)}
      onChange={onChange}
      passwordInput=""
      setPasswordInput={vi.fn()}
      isEditing={false}
      hadPassword={false}
      clearPassword={false}
      setClearPassword={vi.fn()}
      inputClass="input"
      labelClass="label"
    />
  );
  const { rerender } = render(fields(overrides));
  return {
    onChange,
    /** Re-render with the next draft, the way the dialog's reducer would. */
    apply: (draft: Partial<ConnectionDraft>) => rerender(fields(draft)),
  };
}

describe("MssqlFormFields trust warning (#1063)", () => {
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

  it("does not warn when TLS is off", () => {
    renderMssql({ sslMode: "disable" });
    expect(
      screen.queryByText(/Certificate verification is skipped/),
    ).not.toBeInTheDocument();
  });
});

// Purpose: #1649 — the encryption checkbox is controlled by `sslMode` itself,
// so its onChange cannot read the posture that was selected before the flip.
// The first version of this handler tried to, which made the "on" branch
// constant-fold to `require`: two clicks silently demoted a stored `verify-full`
// connection to encrypted-but-unverified. The pre-#1649 pair restored
// `verify-full` on the same two clicks. Round trips, not single clicks, are what
// pin the posture. (2026-08-03)
describe("MssqlFormFields encryption toggle posture (#1649)", () => {
  function clickEncryption() {
    fireEvent.click(screen.getByLabelText("Enable encryption (TLS)"));
  }

  it.each(["verify-full", "require", "verify-ca"] as const)(
    "turning encryption off from %s forces plaintext and drops the CA reference",
    (sslMode) => {
      const { onChange } = renderMssql({
        sslMode,
        caCertPath: "/etc/ssl/ca.pem",
      });
      clickEncryption();
      expect(onChange).toHaveBeenCalledWith({
        sslMode: "disable",
        caCertPath: null,
      });
    },
  );

  it.each(["disable", "prefer"] as const)(
    "turning encryption on from %s selects the verifying posture, never skip-verify",
    (sslMode) => {
      const { onChange } = renderMssql({ sslMode, caCertPath: "/stale.pem" });
      clickEncryption();
      // The CA anchor goes on this branch too: `verify-full` does not read it,
      // and leaving it would let the adjacent trust checkbox restore a
      // `verify-ca` this connection never had (`draftVerifyingSslMode`).
      expect(onChange).toHaveBeenCalledWith({
        sslMode: "verify-full",
        caCertPath: null,
      });
    },
  );

  it("does not demote verify-full across an off/on round trip", () => {
    // The regression this pins: click one wrote `disable`, click two wrote
    // `require`, so a stored `verify-full` connection came back encrypted but
    // unverified. Only a round trip catches it — either click alone looks right.
    let draft: Partial<ConnectionDraft> = { sslMode: "verify-full" };
    const { onChange, apply } = renderMssql(draft);
    for (let click = 0; click < 2; click++) {
      clickEncryption();
      draft = { ...draft, ...onChange.mock.calls[click]![0] };
      apply(draft);
    }
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(draft.sslMode).toBe("verify-full");
    expect(screen.getByLabelText("Enable encryption (TLS)")).toBeChecked();
  });
});

// Purpose: #1649 — the same round-trip rule on the adjacent control. The trust
// checkbox is also controlled by the posture, so its unchecked branch has to
// derive the verifying posture from the draft's CA anchor. SQL Server renders no
// sslmode dropdown, so a `verify-ca` demoted here could not be restored from the
// dialog at all. (2026-08-03)
describe("MssqlFormFields trust toggle posture (#1649)", () => {
  function clickTrust() {
    fireEvent.click(screen.getByLabelText("Trust server certificate"));
  }

  it("restores verify-ca across a trust check/uncheck round trip", () => {
    let draft: Partial<ConnectionDraft> = {
      sslMode: "verify-ca",
      caCertPath: "/opt/corp-ca.pem",
    };
    const { onChange, apply } = renderMssql(draft);
    for (let click = 0; click < 2; click++) {
      clickTrust();
      draft = { ...draft, ...onChange.mock.calls[click]![0] };
      apply(draft);
    }
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(draft).toMatchObject({
      sslMode: "verify-ca",
      caCertPath: "/opt/corp-ca.pem",
    });
    expect(screen.getByLabelText("Trust server certificate")).not.toBeChecked();
  });

  it("restores verify-full across a round trip when no CA anchor is set", () => {
    let draft: Partial<ConnectionDraft> = { sslMode: "verify-full" };
    const { onChange, apply } = renderMssql(draft);
    for (let click = 0; click < 2; click++) {
      clickTrust();
      draft = { ...draft, ...onChange.mock.calls[click]![0] };
      apply(draft);
    }
    expect(draft.sslMode).toBe("verify-full");
  });
});
