import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionDraft } from "@/types/connection";
import TlsSkipVerifyToggle from "./TlsSkipVerifyToggle";

// Purpose: #1649 — this checkbox is shared by every on/off TLS engine
// (MongoDB / Redis / Valkey / Elasticsearch / OpenSearch) and is controlled by
// `sslMode` alone, so its handler cannot read back the posture that preceded a
// flip. The first version hard-coded `verify-full` on the unchecked branch,
// which turned a stored `verify-ca` into `verify-full` after one check/uncheck
// and left its `caCertPath` attached to a posture that ignores it. Round trips,
// not single clicks, are what pin the posture. (2026-08-03)
function makeDraft(overrides: Partial<ConnectionDraft> = {}): ConnectionDraft {
  return {
    id: "",
    name: "",
    dbType: "mongodb",
    host: "localhost",
    port: 27017,
    user: "",
    password: null,
    database: "",
    groupId: null,
    color: null,
    paradigm: "document",
    sslMode: "verify-full",
    ...overrides,
  };
}

function renderToggle(overrides: Partial<ConnectionDraft> = {}) {
  const onChange = vi.fn();
  const view = (draft: Partial<ConnectionDraft>) => (
    <TlsSkipVerifyToggle draft={makeDraft(draft)} onChange={onChange} />
  );
  const { rerender } = render(view(overrides));
  return {
    onChange,
    /** Re-render with the next draft, the way the dialog's reducer would. */
    apply: (draft: Partial<ConnectionDraft>) => rerender(view(draft)),
  };
}

function clickTrust() {
  fireEvent.click(screen.getByLabelText("Trust server certificate"));
}

describe("TlsSkipVerifyToggle posture (#1649)", () => {
  it("does not render while TLS is off", () => {
    renderToggle({ sslMode: "prefer" });
    expect(
      screen.queryByLabelText("Trust server certificate"),
    ).not.toBeInTheDocument();
  });

  it.each(["verify-full", "verify-ca"] as const)(
    "checking from %s selects skip-verify and keeps the CA anchor",
    (sslMode) => {
      const { onChange } = renderToggle({
        sslMode,
        caCertPath: "/opt/corp-ca.pem",
      });
      clickTrust();
      // Only the posture moves — the anchor is what lets the uncheck below
      // restore `verify-ca` instead of guessing.
      expect(onChange).toHaveBeenCalledWith({ sslMode: "require" });
    },
  );

  it("restores verify-ca across a check/uncheck round trip", () => {
    // The regression this pins: click two wrote `verify-full`, so a connection
    // stored as `verify-ca` came back verifying against the public roots alone
    // with its CA path orphaned. Neither click alone looks wrong.
    let draft: Partial<ConnectionDraft> = {
      sslMode: "verify-ca",
      caCertPath: "/opt/corp-ca.pem",
    };
    const { onChange, apply } = renderToggle(draft);
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
    const { onChange, apply } = renderToggle(draft);
    for (let click = 0; click < 2; click++) {
      clickTrust();
      draft = { ...draft, ...onChange.mock.calls[click]![0] };
      apply(draft);
    }
    expect(draft.sslMode).toBe("verify-full");
  });

  it("treats a whitespace-only CA path as no anchor", () => {
    // Matches the backend's `require_ca_cert_path`, which trims before
    // deciding — a hand-edited `connections.json` can carry `" "`, and
    // restoring `verify-ca` there would rebuild a posture the save rejects.
    const { onChange } = renderToggle({ sslMode: "require", caCertPath: "  " });
    clickTrust();
    expect(onChange).toHaveBeenCalledWith({ sslMode: "verify-full" });
  });
});
