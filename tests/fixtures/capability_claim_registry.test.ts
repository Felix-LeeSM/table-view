import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ADAPTER_CONFORMANCE_MATRIX,
  CONFORMANCE_CHECKS,
  type ConformanceArea,
} from "@/types/adapterConformance";
import { DATABASE_TYPE_LABELS, type DatabaseType } from "@/types/connection";
import {
  CAPABILITY_CLAIM_REGISTRY,
  CLAIM_PATTERNS,
  type ClaimHit,
  FROZEN_INVENTORY_PATHS,
  findClaimHits,
  normalizeProse,
  SWEEP_SELF_REFERENCE_PATHS,
} from "./capability_claim_registry";

// Issue #2116 — the acceptance command. `adapterConformance.ts` is the single
// ledger for adapter capability/DDL claims; every prose copy of a ledger fact
// must be registered in `capability_claim_registry.ts` with a reason, and every
// registered copy must still say something the ledger agrees with.
//
// Run it alone with:
//   pnpm exec vitest run tests/fixtures/capability_claim_registry.test.ts
//
// It rides the `Frontend Tests (shard N/3)` matrix, which the required
// `Frontend Checks` context grades — so this is a required lane, not advisory.

/**
 * Tracked text files, which is exactly the corpus the frozen inventory
 * commands searched (`git grep` searches tracked content). Reading the working
 * tree rather than a rev is deliberate: the guard has to fail on prose that a
 * PR is adding right now, not on prose that already landed.
 */
let trackedTextFilesCache: readonly { path: string; text: string }[] | null =
  null;

// Memoized: five call sites below, and each miss re-reads every tracked file.
function trackedTextFiles(): readonly { path: string; text: string }[] {
  if (trackedTextFilesCache) return trackedTextFilesCache;
  trackedTextFilesCache = readTrackedTextFiles();
  return trackedTextFilesCache;
}

function readTrackedTextFiles(): readonly { path: string; text: string }[] {
  const paths = execFileSync("git", ["ls-files", "-z"], {
    encoding: "buffer",
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter(
      (path) => path.length > 0 && !SWEEP_SELF_REFERENCE_PATHS.includes(path),
    );

  return paths.flatMap((path) => {
    let buffer: Buffer;
    try {
      buffer = readFileSync(path);
    } catch {
      // A tracked path missing from the working tree (sparse checkout, a
      // deletion staged mid-run) carries no prose to sweep.
      return [];
    }
    // Same binary test git itself uses: a NUL byte in the head of the file.
    if (buffer.subarray(0, 8000).includes(0)) return [];
    return [{ path, text: buffer.toString("utf8") }];
  });
}

interface LocatedHit extends ClaimHit {
  readonly path: string;
}

function sweep(
  files: readonly { path: string; text: string }[],
): readonly LocatedHit[] {
  return files.flatMap(({ path, text }) =>
    findClaimHits(text).map((hit) => ({ ...hit, path })),
  );
}

// A file can hold both a copy of a ledger fact and prose the pattern only
// caught by accident, so it may carry one row per disposition. Registration is
// keyed on (path, phrase) across every row.
function registeredKeys(): ReadonlySet<string> {
  return new Set(
    CAPABILITY_CLAIM_REGISTRY.flatMap((row) =>
      row.phrases.map((phrase) => `${row.path} :: ${phrase}`),
    ),
  );
}

function unregistered(hits: readonly LocatedHit[]): readonly string[] {
  const registered = registeredKeys();
  return [
    ...new Set(
      hits
        .filter((hit) => !registered.has(`${hit.path} :: ${hit.phrase}`))
        .map((hit) => `${hit.path} :: [${hit.patternId}] ${hit.phrase}`),
    ),
  ].sort();
}

type LedgerState = "supported" | "unsupported" | "deferred" | "absent";

function ledgerState(dbType: DatabaseType, check: string): LedgerState {
  const area = check.split(".")[0] as ConformanceArea;
  const claim = ADAPTER_CONFORMANCE_MATRIX[dbType].areas[area];
  if (!claim) return "absent";
  if (claim.checks.includes(check)) return "supported";
  if (claim.deferred.includes(check)) return "deferred";
  if (claim.unsupported.includes(check)) return "unsupported";
  return "absent";
}

// A synthetic file is enough to prove the sweep is the thing catching the
// violation: it goes through `sweep` and `unregistered`, the same two functions
// the acceptance case runs, so a pattern that rots into matching nothing fails
// here instead of passing the repo sweep silently.
function seeded(text: string): readonly string[] {
  return unregistered(
    sweep([{ path: "docs/product/seeded-violation.md", text }]),
  );
}

describe("capability claim registry (#2116)", () => {
  it("registers every capability-claim copy in the tree", () => {
    const offenders = unregistered(sweep(trackedTextFiles()));

    expect(
      offenders,
      `Unregistered capability-claim prose. ${adapterConformancePointer()}\n` +
        offenders.map((line) => `  ${line}`).join("\n"),
    ).toEqual([]);
  });

  it("keeps no dead row in the registry", () => {
    const live = new Set(
      sweep(trackedTextFiles()).map((hit) => `${hit.path} :: ${hit.phrase}`),
    );
    const dead = CAPABILITY_CLAIM_REGISTRY.flatMap((row) =>
      row.phrases
        .filter((phrase) => !live.has(`${row.path} :: ${phrase}`))
        .map((phrase) => `${row.path} :: ${phrase}`),
    ).sort();

    // Reason: a registry that only ever grows is green whether the prose is
    // still there or was reworded years ago, and only the first is worth
    // having. Rewording a copy must land in the same PR as its row.
    expect(
      dead,
      `Registry rows whose prose no longer exists — delete the row or fix the ` +
        `phrase:\n${dead.map((line) => `  ${line}`).join("\n")}`,
    ).toEqual([]);
  });

  it("holds every ledger fact its registered copies depend on", () => {
    const broken = CAPABILITY_CLAIM_REGISTRY.flatMap((row) =>
      (row.claims ?? [])
        .filter(
          (claim) => ledgerState(claim.dbType, claim.check) !== claim.state,
        )
        .map(
          (claim) =>
            `${row.path} claims ${claim.dbType}.${claim.check} is ` +
            `${claim.state}, ledger says ${ledgerState(claim.dbType, claim.check)}`,
        ),
    ).sort();

    // This is the half that makes the ledger single. Flipping a capability in
    // `adapterConformance.ts` turns every prose copy of the old fact red and
    // names the file, which is what PR #2103 had no way to produce.
    expect(
      broken,
      `Prose copies contradict the ledger — update the prose and the row, or ` +
        `revert the ledger:\n${broken.map((line) => `  ${line}`).join("\n")}`,
    ).toEqual([]);
  });

  it("references only ledger ids that exist", () => {
    const checkIds = new Set(CONFORMANCE_CHECKS.map((check) => check.id));
    const dbTypes = new Set(Object.keys(DATABASE_TYPE_LABELS));
    const unknown = CAPABILITY_CLAIM_REGISTRY.flatMap((row) =>
      (row.claims ?? []).flatMap((claim) => [
        ...(checkIds.has(claim.check)
          ? []
          : [`${row.path}: check ${claim.check}`]),
        ...(dbTypes.has(claim.dbType)
          ? []
          : [`${row.path}: dbType ${claim.dbType}`]),
      ]),
    ).sort();

    expect(unknown, unknown.join("\n")).toEqual([]);

    // Two rows claiming the same phrase would let one of them rot unnoticed:
    // the dead-row check reads the sweep, which cannot tell them apart.
    const keys = CAPABILITY_CLAIM_REGISTRY.flatMap((row) =>
      row.phrases.map((phrase) => `${row.path} :: ${phrase}`),
    );
    expect(keys.length, "duplicate (path, phrase) in the registry").toBe(
      new Set(keys).size,
    );

    for (const row of CAPABILITY_CLAIM_REGISTRY) {
      expect(row.reason.length, `${row.path} needs a reason`).toBeGreaterThan(
        20,
      );
      if (row.disposition === "ledger-dependent") {
        expect(
          row.claims?.length ?? 0,
          `${row.path} is ledger-dependent but names no ledger fact`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("accounts for every file the frozen #2116 inventory named", () => {
    // The acceptance criterion: all 69 hits of the frozen inventory land in
    // (a) deleted, (b) generated, or (c) registered. Nothing was generated —
    // eight product/roadmap pages phrase the same boundary differently and for
    // different readers, so a generator would have produced worse prose than
    // it replaced. A path may leave this check
    // only by losing its prose entirely, which the sweep would then confirm.
    // Deliberately NOT conditioned on the file still being swept: that would
    // let someone narrow a pattern until a frozen file stops matching and call
    // the criterion met. Dropping a path from the list has to be an explicit
    // edit here, and the length assertion makes it one.
    const registered = new Set(CAPABILITY_CLAIM_REGISTRY.map((r) => r.path));
    const missing = FROZEN_INVENTORY_PATHS.filter(
      (path) => existsSync(path) && !registered.has(path),
    );

    expect(
      missing,
      `Frozen-inventory files that still exist but carry no registry row. ` +
        `If the prose was deleted, drop the path from FROZEN_INVENTORY_PATHS ` +
        `in the same commit:\n${missing.join("\n")}`,
    ).toEqual([]);
    expect(FROZEN_INVENTORY_PATHS).toHaveLength(33);

    // The other way a frozen path stays accounted for. An upstream rewrite can
    // leave a file whose claim prose no pattern class matches any more, and
    // then this check (which wants a row) and the dead-row check (which
    // forbids a phrase that no longer matches) contradict each other — the
    // failure message above would be telling you to drop a path the length
    // assertion pins. A phrase-less row records the retirement instead, and it
    // is legal only while the file really does sweep clean.
    const texts = new Map(
      trackedTextFiles().map((file) => [file.path, file.text]),
    );
    const emptyButLive = CAPABILITY_CLAIM_REGISTRY.filter(
      (row) => row.phrases.length === 0,
    )
      .filter((row) => findClaimHits(texts.get(row.path) ?? "").length > 0)
      .map((row) => row.path)
      .sort();

    expect(
      emptyButLive,
      `Phrase-less rows whose file still matches a pattern — register the ` +
        `phrases instead of retiring the path:\n${emptyButLive.join("\n")}`,
    ).toEqual([]);
  });

  it("catches a seeded violation of each pattern class", () => {
    // One per class, phrased the way the class is actually written in the tree.
    for (const [patternId, violation] of [
      [
        "scope-narrowing",
        "SQLite now reaches structured DDL parity with PostgreSQL.",
      ],
      [
        "hidden-affordance",
        "The Identity checkbox stays hidden for every file-backed engine.",
      ],
      ["adapter-execution", "The wired adapter can run ALTER TABLE on SQLite."],
      [
        "atomicity-policy",
        "Commit follows atomic policy C, so an index failure leaves the table.",
      ],
    ] as const) {
      expect(
        seeded(violation),
        `${patternId} seeded violation went undetected`,
      ).toHaveLength(1);
    }
  });

  it("widens the frozen inventory pattern where #2103 lost a slice", () => {
    // Contraction. Verbatim from the tree at rev dd1d9d0a
    // (`src/components/structure/IndexesEditor.tsx`), which #2103's sweeps
    // covered and never matched.
    const contraction =
      "// #1460 — Create Index hidden when the engine's adapter can't run it.";
    const adapterExecution = CLAIM_PATTERNS.find(
      (entry) => entry.id === "adapter-execution",
    );
    expect(adapterExecution).toBeDefined();
    expect(adapterExecution?.inventory.test(contraction)).toBe(false);
    expect(seeded(contraction)).toHaveLength(1);

    // Line wrap across a JSDoc leader. Line-bounded matching never sees it.
    const wrapped =
      " * the engine's adapter cannot\n * run ALTER TABLE, so the";
    expect(
      wrapped.split("\n").some((line) => findClaimHits(line).length > 0),
    ).toBe(false);
    expect(seeded(wrapped)).toHaveLength(1);

    // A comment-only line stays a hard bound, so two unrelated doc paragraphs
    // cannot be fused into one match.
    expect(
      seeded(" * the engine's adapter cannot\n *\n * run ALTER TABLE"),
    ).toEqual([]);

    // Punctuation anchoring: the frozen alternative required a trailing comma.
    const noComma = "SQLite structured DDL first slice rejects index creation.";
    const scopeNarrowing = CLAIM_PATTERNS.find(
      (entry) => entry.id === "scope-narrowing",
    );
    expect(scopeNarrowing?.inventory.test(noComma)).toBe(false);
    expect(seeded(noComma)).toHaveLength(1);
  });

  it("leaves prose that states no capability claim alone", () => {
    // False-positive controls. Without these the sweep is green both when the
    // tree is clean and when a pattern has widened into matching everything.
    for (const benign of [
      "The connection list stays sorted by last use.",
      "Policy Change Review happens every six months for advisories.",
      "The adapter can serialize a decimal column without precision loss.",
      "Index creation is queued behind the current migration.",
    ]) {
      expect(seeded(benign), benign).toEqual([]);
    }
  });

  it("proves its one exclusion removes hits, unlike the frozen ones", () => {
    // Requirement from the issue: an exclusion clause that filters nothing
    // looks precise and is not. Measured at rev dd1d9d0a, every clause the
    // frozen commands carried (`docs/archives/**`, `*.json`, `*.lock`, and
    // P3's `-- src`) removed zero hits, so the guard carries none of them. The
    // self-reference exclusion is the only one left, and it earns its place.
    const selfHits = SWEEP_SELF_REFERENCE_PATHS.map((path) => ({
      path,
      text: readFileSync(path, "utf8"),
    }));

    expect(sweep(selfHits).length).toBeGreaterThan(0);
    for (const path of SWEEP_SELF_REFERENCE_PATHS) {
      expect(trackedTextFiles().some((file) => file.path === path)).toBe(false);
    }
  });

  it("normalizes a claim that a whitespace-blind sweep would split", () => {
    expect(normalizeProse("adapter cannot\nrun ALTER")).toBe(
      "adapter cannot run ALTER",
    );
    expect(normalizeProse("adapter cannot\n\nrun ALTER")).toBe(
      "adapter cannot\nrun ALTER",
    );

    // Rust module docs use `//!`, and the `!` has to come off with the slashes.
    // Leave it behind and the leader strips to a bare `!`, which is neither
    // empty (so a `//!` line stops bounding blocks) nor absent (so it sits in
    // the middle of a wrapped claim and the pattern misses it). The SQLite
    // native-DDL module this registry now covers is written entirely in `//!`.
    expect(normalizeProse("//! the adapter cannot\n//! run ALTER TABLE")).toBe(
      "the adapter cannot run ALTER TABLE",
    );
    expect(seeded("//! the adapter cannot\n//! run ALTER TABLE")).toHaveLength(
      1,
    );
    expect(seeded("//! the adapter cannot\n//!\n//! run ALTER TABLE")).toEqual(
      [],
    );
  });
});

function adapterConformancePointer(): string {
  return (
    "Every copy of an adapter capability/DDL claim is registered in " +
    "tests/fixtures/capability_claim_registry.ts, whose ledger is " +
    "src/types/adapterConformance.ts. Delete the sentence, or add a row " +
    "naming the ledger facts it restates."
  );
}
