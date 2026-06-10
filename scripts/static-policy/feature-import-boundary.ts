import { posix as path } from "node:path";

export const FEATURE_IMPORT_BOUNDARY_SCOPE = "src/features/";

type NormalizeRepoPath = (path: string) => string;

type FeatureImportTarget = {
  readonly feature: string;
  readonly internal: boolean;
};

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
  )) {
    specifiers.push(match[1]!);
  }
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

function isProductionTypeScriptSource(repoPath: string): boolean {
  return (
    (repoPath.endsWith(".ts") || repoPath.endsWith(".tsx")) &&
    !repoPath.includes("/__tests__/") &&
    !repoPath.endsWith(".test.ts") &&
    !repoPath.endsWith(".test.tsx") &&
    !repoPath.endsWith(".spec.ts") &&
    !repoPath.endsWith(".spec.tsx")
  );
}

function featureNameFromRepoPath(repoPath: string): string | undefined {
  const segments = repoPath.split("/");
  if (segments[0] !== "src" || segments[1] !== "features") return undefined;
  return segments[2];
}

function isFeaturePublicApiTarget(segmentsAfterFeature: readonly string[]) {
  if (segmentsAfterFeature.length === 0) return true;
  if (segmentsAfterFeature.length !== 1) return false;
  return /^index(?:\.[cm]?tsx?)?$/.test(segmentsAfterFeature[0]!);
}

function featureImportTargetFromRepoPath(
  targetPath: string,
): FeatureImportTarget | undefined {
  const segments = targetPath.split("/").filter(Boolean);
  if (segments[0] !== "src" || segments[1] !== "features") return undefined;
  const feature = segments[2];
  if (feature === undefined) return undefined;
  return {
    feature,
    internal: !isFeaturePublicApiTarget(segments.slice(3)),
  };
}

function featureImportTargetFromSpecifier(
  sourcePath: string,
  specifier: string,
): FeatureImportTarget | undefined {
  if (specifier.startsWith("@features/")) {
    return featureImportTargetFromRepoPath(
      `src/features/${specifier.slice("@features/".length)}`,
    );
  }
  if (specifier.startsWith("@/features/")) {
    return featureImportTargetFromRepoPath(
      `src/features/${specifier.slice("@/features/".length)}`,
    );
  }
  if (!specifier.startsWith(".")) return undefined;

  const targetPath = path.normalize(
    path.join(path.dirname(sourcePath), specifier),
  );
  return featureImportTargetFromRepoPath(targetPath);
}

export function findFeatureImportBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
  normalizeRepoPath: NormalizeRepoPath,
): string[] {
  const failures: string[] = [];

  for (const [filePath, source] of [...fileSources.entries()].sort()) {
    const repoPath = normalizeRepoPath(filePath);
    const sourceFeature = featureNameFromRepoPath(repoPath);
    if (sourceFeature === undefined) continue;
    if (!isProductionTypeScriptSource(repoPath)) continue;

    for (const specifier of collectImportSpecifiers(source)) {
      const target = featureImportTargetFromSpecifier(repoPath, specifier);
      if (target === undefined) continue;
      if (!target.internal) continue;
      if (target.feature === sourceFeature) continue;

      failures.push(
        `${repoPath}: import ${target.feature} feature internals through src/features/${target.feature}/index.ts, not ${specifier}.`,
      );
    }
  }

  return failures;
}
