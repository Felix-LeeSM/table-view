-- ---------------------------------------------------------------------------
-- ssh_host_key_pins — TOFU pins for SSH tunnel jump hosts (#1064, ADR 0052
-- Q4). One row per (host, port): the OpenSSH-style `SHA256:<base64>`
-- fingerprint the client verified on first contact. A connection dials only
-- when the presented fingerprint matches its pin; a mismatch hard-fails and
-- recovers only through the explicit "delete the pin, re-confirm" step, so
-- deleting a row here is a trust decision, not cleanup.
--
-- Pins are machine-local trust state and stay out of the export envelope
-- (grill decision, 2026-07-17).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ssh_host_key_pins (
    host        TEXT NOT NULL,
    port        INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    pinned_at   INTEGER NOT NULL,
    PRIMARY KEY (host, port)
);
