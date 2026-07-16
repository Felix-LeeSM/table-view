const SEARCH_DSL_RAW_PATH_TARGET_ERROR =
  "Search DSL execution only accepts index or alias targets, not raw/destructive paths";
const DELETE_BY_QUERY_RAW_PATH_TARGET_ERROR =
  "delete-by-query only accepts index or alias targets, not raw/destructive paths";

const ADMIN_TARGETS = [
  "_cat",
  "_cluster",
  "_tasks",
  "_snapshot",
  "_security",
  "_ilm",
  "_aliases",
  "_template",
  "_index_template",
  "_nodes",
  "_plugins",
];

export function getSearchDslTargetError(rawTarget: string): string | null {
  return searchTargetPolicyError(rawTarget, {
    empty: "Search DSL requires an index target",
    wildcard: "Search DSL wildcard targets require an explicit safe contract",
    rawPath: SEARCH_DSL_RAW_PATH_TARGET_ERROR,
    adminPrefix: false,
  });
}

export function getDeleteByQueryPreviewTargetError(
  rawTarget: string,
): string | null {
  return searchTargetPolicyError(rawTarget, {
    empty: "delete-by-query requires an index target",
    wildcard: "delete-by-query wildcard targets are unsupported",
    rawPath: DELETE_BY_QUERY_RAW_PATH_TARGET_ERROR,
    adminPrefix: true,
  });
}

function searchTargetPolicyError(
  rawTarget: string,
  messages: {
    empty: string;
    wildcard: string;
    rawPath: string;
    adminPrefix: boolean;
  },
): string | null {
  const target = rawTarget.trim();
  if (!target) return messages.empty;
  if (target === "_all" || target.includes("*")) return messages.wildcard;

  const lower = target.toLowerCase();
  if (
    target.includes("/") ||
    target.includes("\\") ||
    target.includes("?") ||
    target.includes("#") ||
    target.includes(",") ||
    Array.from(target).some((ch) => /\s/.test(ch)) ||
    lower.includes("%2f") ||
    lower.includes("%5c") ||
    lower.includes("_delete_by_query") ||
    lower.includes("_update_by_query") ||
    lower.includes("_bulk") ||
    lower.includes("_reindex") ||
    lower.includes("_scripts") ||
    matchesAdminTarget(lower, messages.adminPrefix)
  ) {
    return messages.rawPath;
  }
  return null;
}

function matchesAdminTarget(target: string, prefix: boolean) {
  return ADMIN_TARGETS.some((admin) =>
    prefix
      ? target === admin || target.startsWith(`${admin}*`)
      : target === admin,
  );
}
