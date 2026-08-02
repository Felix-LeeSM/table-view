//! Shared server-version triplet parsing.
//!
//! Issue #1821 — the MongoDB runtime-capability probe needs the same
//! `major.minor.patch` extraction the MySQL/MariaDB adapter already had, so
//! the two helpers moved out of `db/mysql/version.rs` instead of being copied
//! into `db/mongodb/capability.rs`. Engine-specific quirks (MariaDB's
//! `5.5.5-` compatibility prefix, family detection) stay in the caller — this
//! module only knows how to read a triplet out of a version string and how to
//! compare two triplets.

/// Extract `(major, minor, patch)` from the first numeric run in `raw`.
///
/// Scans to the first ASCII digit, then keeps digits and `.` until any other
/// character ends the run — so a pre-release / build suffix is dropped
/// (`"4.9.0-rc0"` → `(4, 9, 0)`). Missing components default to `0`
/// (`"5"` → `(5, 0, 0)`), which is why a caller comparing against a minimum
/// must not read "absent patch" as "unknown patch".
///
/// Returns `None` when `raw` carries no parsable leading number at all — the
/// caller's cue to fall back to its conservative (feature-closed) default
/// rather than guess.
pub(crate) fn parse_version_triplet(raw: &str) -> Option<(u32, u32, u32)> {
    let mut start = None;
    let mut end = raw.len();
    for (idx, ch) in raw.char_indices() {
        if ch.is_ascii_digit() {
            start.get_or_insert(idx);
            continue;
        }
        if start.is_some() && ch != '.' {
            end = idx;
            break;
        }
    }

    let version = &raw[start?..end];
    let mut parts = version
        .split('.')
        .take(3)
        .map(|part| part.parse::<u32>().ok());
    let major = parts.next().flatten()?;
    let minor = parts.next().flatten().unwrap_or(0);
    let patch = parts.next().flatten().unwrap_or(0);
    Some((major, minor, patch))
}

/// Tuple ordering — `(8, 0, 16) >= (8, 0, 16)` is inclusive at the boundary.
pub(crate) fn is_at_least(major: u32, minor: u32, patch: u32, minimum: (u32, u32, u32)) -> bool {
    (major, minor, patch) >= minimum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_triplet() {
        assert_eq!(parse_version_triplet("7.0.5"), Some((7, 0, 5)));
    }

    // Reason: issue #1821 — MongoDB release candidates ship a pre-release tag
    // (`4.9.0-rc0`); dropping it must not lose the triplet, otherwise every RC
    // server would read as "version unknown" and lose access to features it
    // actually has.
    #[test]
    fn drops_pre_release_and_build_suffixes() {
        assert_eq!(parse_version_triplet("4.9.0-rc0"), Some((4, 9, 0)));
        assert_eq!(parse_version_triplet("6.0.11-alpha.2"), Some((6, 0, 11)));
        assert_eq!(parse_version_triplet("5.0.0+build.7"), Some((5, 0, 0)));
    }

    // Reason: issue #1821 — servers report varying component counts; the
    // missing components must read as 0 rather than aborting the parse.
    #[test]
    fn missing_components_default_to_zero() {
        assert_eq!(parse_version_triplet("5"), Some((5, 0, 0)));
        assert_eq!(parse_version_triplet("5.2"), Some((5, 2, 0)));
        // A fourth component is ignored rather than rejected.
        assert_eq!(parse_version_triplet("4.4.29.1"), Some((4, 4, 29)));
    }

    #[test]
    fn returns_none_without_a_leading_number() {
        assert_eq!(parse_version_triplet("unknown"), None);
        assert_eq!(parse_version_triplet(""), None);
    }

    #[test]
    fn is_at_least_is_inclusive_at_the_boundary() {
        assert!(is_at_least(8, 0, 16, (8, 0, 16)));
        assert!(!is_at_least(8, 0, 15, (8, 0, 16)));
        assert!(is_at_least(8, 1, 0, (8, 0, 16)));
        assert!(!is_at_least(7, 9, 9, (8, 0, 16)));
    }
}
