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
 * All three now call this. The count is `src/` only: the Rust side keeps its
 * own twins — `db::version::is_at_least` in `table-view-core`, and the
 * nested-OR copy in `sql-parser-core`'s `completion::vocabulary`, which gates
 * the same MariaDB `RETURNING` at the same `(10, 0, 5)`. Neither can import a
 * TypeScript module, so collapsing those is a separate change on that side.
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
 * Component-wise order, most significant first: a higher `major` wins
 * outright, a lower one loses outright, and only ties fall through to the next
 * component. Each component is compared as a number, which is what separates
 * this from the two shapes that look equivalent and are not — a string compare
 * of the joined triplet (`"10.0.0" < "9.0.0"`) and a fixed-radix fold
 * (`major * 10000 + …`, which overflows into the next component past 99).
 * `versionOrder.test.ts` pins inputs where each of those disagrees.
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
