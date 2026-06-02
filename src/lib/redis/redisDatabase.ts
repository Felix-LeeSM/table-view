const REDIS_DATABASE_ERROR =
  "Redis database must be an integer between 0 and 65535.";

export function parseRedisDatabaseIndex(
  database: string | undefined,
): number | undefined {
  if (database === undefined || database.trim().length === 0) {
    return undefined;
  }
  const trimmed = database.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(REDIS_DATABASE_ERROR);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(REDIS_DATABASE_ERROR);
  }
  return parsed;
}
