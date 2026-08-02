/**
 * Ordering on a parsed `major.minor.patch` triplet.
 *
 * Deliberately a leaf module: it imports nothing, so both `./dataSource` and
 * `./dataSourceVersionCapabilities` can depend on it even though the latter
 * already imports the former. That cycle is what kept the same three-line
 * comparison hand-copied in three places (PR #2099 review, issue #1821):
 *
 *   - `./dataSource` — `meetsMongoRuntimeRequirement`
 *   - `./dataSourceVersionCapabilities` — MySQL/MariaDB catalog gates
 *   - `@features/completion/sql/sqlCompletionRequest` — MariaDB `RETURNING`
 *
 * All three now call this.
 */

/** The comparable part of any parsed version — the numeric triplet. */
export interface ComparableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Whether `version` is at least `major.minor.patch` (inclusive).
 *
 * Pure lexicographic order on the triplet: a higher `major` wins outright, a
 * lower one loses outright, and only ties fall through to the next component.
 * Pre-release tags are not considered — callers that care must strip or
 * compare them before parsing, since `4.9.0-rc0` and `4.9.0` produce the same
 * triplet.
 */
export function isVersionAtLeast(
  version: ComparableVersion,
  major: number,
  minor: number,
  patch: number,
): boolean {
  if (version.major !== major) return version.major > major;
  if (version.minor !== minor) return version.minor > minor;
  return version.patch >= patch;
}
