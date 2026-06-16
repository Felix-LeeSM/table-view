import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMongoshExpression } from "@features/query";
import {
  REDIS_COMMAND_COMPLETIONS,
  REDIS_UNSUPPORTED_COMMAND_FAMILIES,
  VALKEY_COMMAND_COMPLETIONS,
} from "@features/completion/redis/redisCommandCompletion";
import { describe, expect, it } from "vitest";

const THIS_TEST = "tests/fixtures/unsupported_boundary_contracts.test.ts";
const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "unsupported_boundary_contracts.json",
);

interface BoundaryFixture {
  readonly $schema: "unsupported-boundary-contracts@1";
  readonly issue: 754;
  readonly rows: readonly BoundaryRow[];
}

interface BoundaryRow {
  readonly id: string;
  readonly minimumRow: string;
  readonly products: readonly string[];
  readonly claimBoundary: string;
  readonly docs: readonly BoundaryDocEvidence[];
  readonly fixtureEvidence: readonly BoundaryPathEvidence[];
  readonly sourceGates?: readonly BoundarySourceGate[];
  readonly consumedBy: readonly string[];
  readonly valkeyCompletionExclusions?: readonly string[];
  readonly redisUnsupportedCommands?: readonly string[];
  readonly mongoParserCases?: readonly MongoParserCase[];
}

interface BoundaryDocEvidence {
  readonly path: string;
  readonly mustContain: string;
}

interface BoundaryPathEvidence {
  readonly path: string;
  readonly kind: string;
}

interface BoundarySourceGate {
  readonly path: string;
  readonly mustContain: readonly string[];
}

interface MongoParserCase {
  readonly input: string;
  readonly errorKind:
    | "unsupported-syntax"
    | "unsupported-method"
    | "bson-literal"
    | "multiple-statements"
    | "missing-db-prefix"
    | "invalid-cursor-chain";
}

interface ProfileParityReport {
  readonly runtimeClaimBoundary: {
    readonly profilePresenceIsRuntimeSupportClaim: boolean;
  };
  readonly profiles: Record<
    string,
    {
      readonly id: string;
      readonly paradigm: string;
      readonly connectionKind: string;
      readonly backendAdapter: {
        readonly id: string;
        readonly kind: string;
        readonly capabilitySource: string;
      };
    }
  >;
}

interface ValkeyCompatibilityFixture {
  readonly completionSupport: {
    readonly nonClaim: string;
  };
  readonly commandFamilyMatrix: readonly {
    readonly family: string;
    readonly status: string;
    readonly redisCommands: readonly string[];
  }[];
}

describe("unsupported_boundary_contracts.json", () => {
  it("is a consumed issue #754 fixture with no orphan rows", () => {
    const fixture = loadBoundaryFixture();
    expect(fixture.$schema).toBe("unsupported-boundary-contracts@1");
    expect(fixture.issue).toBe(754);

    const ids = new Set<string>();
    for (const row of fixture.rows) {
      expect(ids.has(row.id)).toBe(false);
      ids.add(row.id);
      expect(row.minimumRow).not.toHaveLength(0);
      expect(row.claimBoundary).not.toHaveLength(0);
      expect(row.docs.length).toBeGreaterThan(0);
      expect(row.fixtureEvidence.length).toBeGreaterThan(0);
      expect(row.consumedBy).toContain(THIS_TEST);
    }
    expect(ids.size).toBe(5);
  });

  it("links each boundary row to current docs wording and fixture paths", () => {
    const fixture = loadBoundaryFixture();
    for (const row of fixture.rows) {
      for (const doc of row.docs) {
        expect(readRepoFile(doc.path), `${row.id} docs ${doc.path}`).toContain(
          doc.mustContain,
        );
      }

      for (const evidence of row.fixtureEvidence) {
        expect(
          existsSync(repoPath(evidence.path)),
          `${row.id} fixture ${evidence.path}`,
        ).toBe(true);
      }

      for (const gate of row.sourceGates ?? []) {
        const source = readRepoFile(gate.path);
        for (const phrase of gate.mustContain) {
          expect(source, `${row.id} source gate ${gate.path}`).toContain(
            phrase,
          );
        }
      }
    }
  });

  it("keeps MSSQL runtime and Oracle declared-only boundaries explicit", () => {
    const row = rowById(
      loadBoundaryFixture(),
      "mssql-runtime-oracle-declared-only-boundaries",
    );
    const report = readJson<ProfileParityReport>(
      row.fixtureEvidence[0]?.path ?? "",
    );

    expect(
      report.runtimeClaimBoundary.profilePresenceIsRuntimeSupportClaim,
    ).toBe(false);
    for (const product of row.products) {
      const profile = report.profiles[product];
      expect(profile?.id).toBe(product);
      expect(profile?.paradigm).toBe("rdb");
      expect(profile?.connectionKind).toBe("server");
      expect(profile?.backendAdapter.id).toBe(product);
      expect(profile?.backendAdapter.kind).toBe("rdb");
      expect(profile?.backendAdapter.capabilitySource).toBe(product);
    }
  });

  it("keeps Valkey non-string mutation and full Redis compatibility outside completion promotion", () => {
    const row = rowById(
      loadBoundaryFixture(),
      "valkey-non-string-mutation-full-redis-nonclaim",
    );
    const compatibility = readJson<ValkeyCompatibilityFixture>(
      row.fixtureEvidence[0]?.path ?? "",
    );

    expect(compatibility.completionSupport.nonClaim).toContain(
      "direct string-key mutation UI evidence",
    );
    expect(compatibility.completionSupport.nonClaim).toContain(
      "full Valkey compatibility evidence",
    );

    const rejectedFamilies = compatibility.commandFamilyMatrix
      .filter((entry) => entry.status === "rejected-until-separate-scope")
      .flatMap((entry) => entry.redisCommands);
    expect(rejectedFamilies).toEqual(
      expect.arrayContaining(["FLUSHDB", "CLUSTER", "MODULE", "SUBSCRIBE"]),
    );

    const valkeyCompletionNames = VALKEY_COMMAND_COMPLETIONS.map(
      (command) => command.name,
    );
    for (const command of row.valkeyCompletionExclusions ?? []) {
      expect(valkeyCompletionNames).not.toContain(command);
    }
  });

  it("keeps Redis full CLI/admin/cluster/pubsub/modules outside command completion", () => {
    const row = rowById(
      loadBoundaryFixture(),
      "redis-cli-admin-cluster-pubsub-modules-nonclaim",
    );
    const unsupportedLabels = REDIS_UNSUPPORTED_COMMAND_FAMILIES.map(
      (family) => family.label,
    );
    expect(unsupportedLabels).toEqual(
      expect.arrayContaining([
        "ACL / CLIENT / CONFIG / DEBUG",
        "CLUSTER / PUBSUB / MODULE / FUNCTION",
        "EVAL / SCRIPT",
        "FLUSH* / UNLINK / RENAME",
        "XGROUP / XREADGROUP",
      ]),
    );

    const redisCompletionNames = REDIS_COMMAND_COMPLETIONS.map(
      (command) => command.name,
    );
    for (const command of row.redisUnsupportedCommands ?? []) {
      expect(redisCompletionNames).not.toContain(command);
    }
  });

  it("keeps Mongo arbitrary JavaScript and shell helpers rejected by the parser boundary", () => {
    const row = rowById(
      loadBoundaryFixture(),
      "mongo-shell-admin-native-document-first-nonclaim",
    );
    for (const parserCase of row.mongoParserCases ?? []) {
      const result = parseMongoshExpression(parserCase.input);
      expect(result.kind, parserCase.input).toBe("error");
      if (result.kind === "error") {
        expect(result.errorKind, parserCase.input).toBe(parserCase.errorKind);
      }
    }
  });
});

function loadBoundaryFixture(): BoundaryFixture {
  return JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as BoundaryFixture;
}

function rowById(fixture: BoundaryFixture, id: string): BoundaryRow {
  const row = fixture.rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Missing unsupported boundary row: ${id}`);
  return row;
}

function readJson<T>(path: string): T {
  return JSON.parse(readRepoFile(path)) as T;
}

function readRepoFile(path: string): string {
  return readFileSync(repoPath(path), "utf-8");
}

function repoPath(path: string): string {
  return resolve(process.cwd(), path);
}
