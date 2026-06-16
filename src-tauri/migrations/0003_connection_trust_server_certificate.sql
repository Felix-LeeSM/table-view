-- Issue #901 — SQL Server certificate trust decision.
-- NULL means caller has not made an explicit certificate decision.
ALTER TABLE connections ADD COLUMN trust_server_certificate INTEGER;
