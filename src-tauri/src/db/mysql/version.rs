use crate::models::DatabaseType;

const MYSQL_CHECK_CONSTRAINT_MIN: (u32, u32, u32) = (8, 0, 16);
const MARIADB_CHECK_CONSTRAINT_MIN: (u32, u32, u32) = (10, 2, 1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MysqlServerFamily {
    Mysql,
    MariaDb,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct MysqlServerVersion {
    pub(super) raw: String,
    family: MysqlServerFamily,
    major: u32,
    minor: u32,
    patch: u32,
}

impl MysqlServerVersion {
    pub(super) fn supports_check_constraint_catalog(&self) -> bool {
        match self.family {
            MysqlServerFamily::Mysql => is_at_least(
                self.major,
                self.minor,
                self.patch,
                MYSQL_CHECK_CONSTRAINT_MIN,
            ),
            MysqlServerFamily::MariaDb => is_at_least(
                self.major,
                self.minor,
                self.patch,
                MARIADB_CHECK_CONSTRAINT_MIN,
            ),
        }
    }
}

pub(super) fn parse_mysql_server_version(
    raw: &str,
    adapter_kind: &DatabaseType,
) -> Option<MysqlServerVersion> {
    let is_mariadb_raw = raw.to_ascii_lowercase().contains("mariadb");
    let parse_source = if is_mariadb_raw {
        raw.strip_prefix("5.5.5-").unwrap_or(raw)
    } else {
        raw
    };
    let (major, minor, patch) = parse_version_triplet(parse_source)?;
    let family = if is_mariadb_raw || matches!(adapter_kind, DatabaseType::Mariadb) {
        MysqlServerFamily::MariaDb
    } else {
        MysqlServerFamily::Mysql
    };

    Some(MysqlServerVersion {
        raw: raw.to_string(),
        family,
        major,
        minor,
        patch,
    })
}

fn parse_version_triplet(raw: &str) -> Option<(u32, u32, u32)> {
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

fn is_at_least(major: u32, minor: u32, patch: u32, minimum: (u32, u32, u32)) -> bool {
    (major, minor, patch) >= minimum
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_extracts_mysql_triplet() {
        let version = parse_mysql_server_version("8.0.36", &DatabaseType::Mysql).unwrap();

        assert_eq!(version.major, 8);
        assert_eq!(version.minor, 0);
        assert_eq!(version.patch, 36);
        assert_eq!(version.family, MysqlServerFamily::Mysql);
    }

    #[test]
    fn parse_version_extracts_mariadb_triplet_from_raw_suffix() {
        let version =
            parse_mysql_server_version("10.11.8-MariaDB-ubu2204", &DatabaseType::Mysql).unwrap();

        assert_eq!(version.major, 10);
        assert_eq!(version.minor, 11);
        assert_eq!(version.patch, 8);
        assert_eq!(version.family, MysqlServerFamily::MariaDb);
    }

    #[test]
    fn parse_version_skips_mariadb_compatibility_prefix() {
        let version =
            parse_mysql_server_version("5.5.5-10.11.8-MariaDB-ubu2204", &DatabaseType::Mysql)
                .unwrap();

        assert_eq!(version.major, 10);
        assert_eq!(version.minor, 11);
        assert_eq!(version.patch, 8);
        assert_eq!(version.family, MysqlServerFamily::MariaDb);
    }

    #[test]
    fn parse_version_uses_adapter_kind_for_mariadb_family() {
        let version = parse_mysql_server_version("10.2.0", &DatabaseType::Mariadb).unwrap();

        assert_eq!(version.family, MysqlServerFamily::MariaDb);
    }

    #[test]
    fn parse_version_returns_none_without_numeric_version() {
        assert!(parse_mysql_server_version("unknown", &DatabaseType::Mysql).is_none());
    }

    #[test]
    fn mysql_check_catalog_gate_starts_at_8_0_16() {
        let before = parse_mysql_server_version("8.0.15", &DatabaseType::Mysql).unwrap();
        let at = parse_mysql_server_version("8.0.16", &DatabaseType::Mysql).unwrap();
        let after = parse_mysql_server_version("8.4.0", &DatabaseType::Mysql).unwrap();

        assert!(!before.supports_check_constraint_catalog());
        assert!(at.supports_check_constraint_catalog());
        assert!(after.supports_check_constraint_catalog());
    }

    #[test]
    fn mariadb_check_catalog_gate_starts_at_10_2_1() {
        let before = parse_mysql_server_version("10.2.0-MariaDB", &DatabaseType::Mariadb).unwrap();
        let at = parse_mysql_server_version("10.2.1-MariaDB", &DatabaseType::Mariadb).unwrap();

        assert!(!before.supports_check_constraint_catalog());
        assert!(at.supports_check_constraint_catalog());
    }
}
