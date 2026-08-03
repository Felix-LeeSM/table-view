/**
 * Ordering on a parsed `major.minor.patch` triplet.
 *
 * Deliberately a leaf module: it imports nothing, so both `./dataSource` and
 * `./dataSourceVersionCapabilities` can depend on it even though the latter
 * already imports the former.
 */

/** The comparable part of any parsed version — the numeric triplet. */
export interface ComparableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * Whether `version` is at least `major.minor.patch` (inclusive). Each
 * component is compared as a number, most significant first.
 *
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
