import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REDIS_COMMAND_COMPLETIONS,
  REDIS_UNSUPPORTED_COMMAND_FAMILIES,
  VALKEY_COMMAND_COMPLETIONS,
} from "@features/completion/redis/redisCommandCompletion";
import { parseMongoshExpression } from "@features/query";
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
        expectDocPin(
          readRepoFile(doc.path),
          doc.mustContain,
          `${row.id} docs ${doc.path}`,
        );
      }

      for (const evidence of row.fixtureEvidence) {
        expect(
          existsSync(repoPath(evidence.path)),
          `${row.id} fixture ${evidence.path}`,
        ).toBe(true);
      }

      // Source gates keep the raw substring match on purpose (no
      // `expectDocPin`): they pin Rust identifiers and a user-facing error
      // string literal, so whitespace is part of the pinned fact, and the
      // over-600-char re-flow that motivated doc normalization is docs-only.
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

  // Reason: doc pins must survive prose re-flow — 11 of the 15 pinned phrases
  // currently sit inside over-600-char doc lines, so the >600-char cleanup would
  // otherwise have to keep each phrase on one unbreakable line forever. Raised
  // as finding F6 in the PR #1838 review (2026-07-26).
  it("matches a doc pin wrapped across lines but still rejects absent wording", () => {
    const phrase = "Search uses an index-catalog-first workbench boundary";
    const wrapped = `- ${phrase.replace(" workbench", "\n  workbench")} for now.\n`;

    // Old raw-substring comparison could not see the wrapped phrase.
    expect(wrapped).not.toContain(phrase);
    expectDocPin(wrapped, phrase, "wrapped doc pin");

    expect(() =>
      expectDocPin(
        wrapped,
        "Search uses a table-first workbench boundary",
        "absent doc pin",
      ),
    ).toThrow(
      /absent doc pin must contain \(whitespace-normalized\): Search uses a table-first workbench boundary/,
    );
  });

  // Reason: normalization must not let a pin be assembled from two paragraphs —
  // a doc could split a claim in half and the pin would keep passing (false
  // pass). Finding N1 in the PR #1840 review (2026-07-26).
  it("rejects a doc pin assembled across a blank line but accepts a wrapped one", () => {
    const phrase = "Search uses an index-catalog-first workbench boundary";
    const head = "Search uses an index-catalog-first";
    const tail = "workbench boundary";

    expect(() =>
      expectDocPin(`${head}\n\n${tail}\n`, phrase, "paragraph-split doc pin"),
    ).toThrow(
      /paragraph-split doc pin must contain \(whitespace-normalized\): Search uses an index-catalog-first workbench boundary/,
    );

    expectDocPin(`${head}\n${tail}\n`, phrase, "line-wrapped doc pin");
  });

  it("keeps MSSQL runtime and Oracle runtime-slice boundaries explicit", () => {
    const row = rowById(
      loadBoundaryFixture(),
      "mssql-runtime-oracle-runtime-slice-boundaries",
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

/**
 * Doc pins are prose, so they are matched whitespace-insensitively: any run of
 * whitespace collapses to a single space on both sides. A pinned phrase may
 * therefore wrap across lines in the document without the pin going stale.
 *
 * Source gates (`row.sourceGates`) intentionally keep the strict raw match —
 * they pin code identifiers and a user-facing error string literal, where
 * whitespace is part of the fact being pinned.
 */
function expectDocPin(content: string, phrase: string, label: string): void {
  expect(
    normalizeDocText(content),
    `${label} must contain (whitespace-normalized): ${phrase}`,
  ).toContain(collapseWhitespace(phrase));
}

/**
 * Collapse whitespace *inside* each paragraph while keeping the blank line as a
 * hard boundary. A pinned phrase may wrap across lines, but it must not be
 * assembled from the tail of one paragraph plus the head of the next — that
 * would let a doc split a claim in half and keep the pin passing (false pass).
 * Sound because no pin contains a newline, so a collapsed phrase can never
 * span the `\n\n` joiner.
 */
function normalizeDocText(text: string): string {
  return text
    .split(/\n[^\S\n]*\n/)
    .map(collapseWhitespace)
    .join("\n\n");
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readRepoFile(path: string): string {
  return readFileSync(repoPath(path), "utf-8");
}

function repoPath(path: string): string {
  return resolve(process.cwd(), path);
}
