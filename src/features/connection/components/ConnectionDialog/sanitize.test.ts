// Purpose: sanitizeMessage credential masking — secret-literal pass (#1389)
// + pattern pass for the sidebar/status path (issue #1453, 2026-07-10).
// The sidebar path (store → ConnectionItem) has no plaintext password in
// scope (backend sends `hasPassword` only), so URI-userinfo / key=value
// masking must work with zero known secrets. Patterns mirror
// `redact_connection_message` in the Rust backend (storage/sql_redact.rs).
import { describe, it, expect } from "vitest";
import { sanitizeMessage } from "./sanitize";

describe("sanitizeMessage", () => {
  // Reason: pre-#1453 contract — known secret literal + URL-encoded form
  // masked (Sprint 178 / #1389) (2026-07-10)
  it("masks a known secret literal and its URL-encoded form", () => {
    expect(sanitizeMessage("auth failed for p@ss and p%40ss", "p@ss")).toBe(
      "auth failed for *** and ***",
    );
  });

  // Reason: issue #1453 — driver errors echo the connection URI; the
  // password segment must be masked without a known secret (2026-07-10)
  it("masks URI userinfo passwords without a known secret", () => {
    expect(
      sanitizeMessage("connect failed: postgres://app:S3cretPw1@db:5432/x"),
    ).toBe("connect failed: postgres://app:***@db:5432/x");
  });

  // Reason: issue #1453 — Redis URLs commonly have an empty user
  // (`redis://:pw@host`); the pattern must not require a user part (2026-07-10)
  it("masks empty-user URI passwords (redis style)", () => {
    expect(
      sanitizeMessage("IO error: redis://:S3cretPw1@redis.local:6379/0"),
    ).toBe("IO error: redis://:***@redis.local:6379/0");
  });

  // Reason: issue #1453 — ADO/libpq style key=value credential pairs
  // (`Password=...` / `pwd=...`) must be masked pattern-based (2026-07-10)
  it("masks key=value credential pairs without a known secret", () => {
    expect(
      sanitizeMessage(
        "cannot open: host=h Password=S3cretPw1;user=u pwd=Oth3r",
      ),
    ).toBe("cannot open: host=h Password=***;user=u pwd=***");
  });

  // Reason: review #1490 B2 — libpq conninfo quotes its values
  // (`password='x'` / `pwd="x"`, spaces allowed inside); the pre-fix value
  // class stopped at the leading quote and leaked the secret (2026-07-11)
  it("masks quoted key=value credentials (libpq conninfo style)", () => {
    expect(sanitizeMessage("FATAL: host=h password='S3cretPw1' user=u")).toBe(
      "FATAL: host=h password=*** user=u",
    );
    expect(sanitizeMessage('cannot open: pwd="S3cretPw1";host=h')).toBe(
      "cannot open: pwd=***;host=h",
    );
    const spaced = sanitizeMessage("FATAL: password='S3cret Pw1' user=u");
    expect(spaced).toBe("FATAL: password=*** user=u");
    expect(spaced).not.toContain("S3cret");
  });

  // Reason: issue #1453 — non-secret error copy (host/port, os error) must
  // survive byte-identical so the error stays actionable (2026-07-10)
  it("leaves non-credential text untouched", () => {
    const raw = "Connection refused (os error 61) at localhost:5432";
    expect(sanitizeMessage(raw)).toBe(raw);
  });

  // Reason: issue #1453 — statuses re-enter via localStorage hydrate and the
  // render path; double application must be a no-op (2026-07-10)
  it("is idempotent on already-masked text", () => {
    const once = sanitizeMessage(
      "postgres://app:S3cretPw1@db:5432/x password=S3cretPw1",
    );
    expect(sanitizeMessage(once)).toBe(once);
  });
});
