import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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

// Live prose = every markdown SOT a reader is expected to trust today. Each
// pruned tree declares itself historical in its own README — `docs/sprints`
// ("Treat docs/sprints/sprint-N/** as historical once the sprint is delivered.
// Do not infer shipped support ... from old contract, handoff, findings ...
// text"), `docs/archives` ("Treat every file under this directory as
// historical"), `docs/explorations` ("현재 SOT 아님") — so retiring a claim must
// not rewrite them. This is `scripts/hooks/policy/check-doc-size.sh`'s prune set
// minus `docs/table_plus`, which is dropped because it prunes zero tracked files
// (an exclusion that filters nothing only looks precise). Measured 2026-07-30:
// 1541 markdown files under README.md/docs/memory, 91 after pruning
// (docs/sprints 1287, docs/archives 159, docs/explorations 4).
const LIVE_PROSE_ROOTS = ["docs", "memory"] as const;
const LIVE_PROSE_ROOT_FILES = ["README.md"] as const;
const FROZEN_PROSE_TREES = [
  "docs/sprints",
  "docs/archives",
  "docs/explorations",
] as const;

interface BoundaryFixture {
  readonly $schema: "unsupported-boundary-contracts@1";
  readonly issue: 754;
  readonly rows: readonly BoundaryRow[];
  readonly retiredClaims?: readonly RetiredClaim[];
}

/**
 * A support claim that used to be a non-claim and is now shipped. `docs[].mustContain`
 * can only assert that the NEW wording arrived somewhere; it cannot see the OLD
 * wording still sitting in a file nobody listed. That gap is what #1812 measured:
 * #1076 promoted live `_delete_by_query` execution, updated three docs/product
 * pages, and left eight other live-prose sentences claiming it was preview-only.
 */
interface RetiredClaim {
  readonly retiredBy: number;
  readonly issue: number;
  readonly reason: string;
  readonly phrases: readonly string[];
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

  // Reason: #1812 — a promoted capability leaves its retired non-claim behind in
  // live prose nobody listed. `docs[].mustContain` is presence-only, so it stays
  // green while a contradicting sentence sits two files over. This sweeps every
  // live-prose markdown file, not a hand-kept path list, because the eight stale
  // #1076 sentences were in files no boundary row named. (2026-07-30)
  it("keeps retired support non-claims out of live prose", () => {
    const retiredClaims = loadBoundaryFixture().retiredClaims ?? [];
    expect(retiredClaims.length).toBeGreaterThan(0);

    const files = liveProseFiles();
    const hits = retiredClaims.flatMap((claim) =>
      files.flatMap((file) => {
        const prose = normalizeDocText(readRepoFile(file));
        return claim.phrases
          .filter((phrase) =>
            prose
              .toLowerCase()
              .includes(collapseWhitespace(phrase.toLowerCase())),
          )
          .map(
            (phrase) =>
              `${file}: "${phrase}" was retired by #${claim.retiredBy} (tracked in #${claim.issue})`,
          );
      }),
    );

    expect(hits).toEqual([]);
  });

  // Reason: the sweep above is only worth its lines if the enumeration really
  // reaches the files that went stale and really prunes the frozen trees, and if
  // the matcher survives an ~80-column re-wrap. All three were false-pass modes
  // this repo has already shipped once. (2026-07-30)
  it("enumerates live prose, prunes frozen trees, and matches across a wrap", () => {
    const files = liveProseFiles();

    // The four files #1812 found stale that no boundary row lists by path.
    for (const stale of [
      "README.md",
      "docs/roadmap/h5.md",
      "docs/contributor-guide/smoke-matrix/h7-ops-security-reliability.md",
      "docs/contributor-guide/release/release-notes-support-matrix.md",
    ]) {
      expect(files, `live prose must reach ${stale}`).toContain(stale);
    }
    // Each prune must remove something. An exclusion that filters nothing reads
    // as precision and is really a blind spot, so assert the tree exists on disk
    // with markdown in it AND that none of it survived the walk.
    for (const frozen of FROZEN_PROSE_TREES) {
      const inTree = readdirSync(repoPath(frozen), {
        recursive: true,
        withFileTypes: true,
      }).filter((entry) => entry.isFile() && entry.name.endsWith(".md"));
      expect(
        inTree.length,
        `${frozen} must hold prunable markdown`,
      ).toBeGreaterThan(0);
      expect(
        files.filter((file) => file.startsWith(`${frozen}/`)),
        `${frozen} must be pruned`,
      ).toEqual([]);
    }

    // A retired phrase re-introduced across a line break must still be caught —
    // prettier keeps `proseWrap: preserve`, so docs wrap by hand at ~80 columns
    // and a raw substring check would miss exactly the sentences #1812 fixed.
    const phrase = "Delete-by-query planning is preview-only";
    const wrapped = "Delete-by-query planning is\npreview-only for Search.\n";
    expect(wrapped).not.toContain(phrase);
    expect(normalizeDocText(wrapped)).toContain(collapseWhitespace(phrase));
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
 * Every repo-relative markdown path a reader is expected to trust as current.
 * Walked, not enumerated: the whole point of the retired-claim sweep is to reach
 * files no boundary row lists, so a hand-kept path list would reproduce the bug
 * it guards against.
 */
function liveProseFiles(): string[] {
  const files = [...LIVE_PROSE_ROOT_FILES];
  for (const root of LIVE_PROSE_ROOTS) {
    for (const entry of readdirSync(repoPath(root), {
      recursive: true,
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const path = relative(
        repoPath("."),
        resolve(entry.parentPath, entry.name),
      );
      if (FROZEN_PROSE_TREES.some((tree) => path.startsWith(`${tree}/`)))
        continue;
      files.push(path);
    }
  }
  return files;
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
