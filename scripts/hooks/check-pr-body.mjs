#!/usr/bin/env node

import fs from "node:fs";

const REQUIRED_SECTIONS = [
  "Summary",
  "Changes",
  "Invariants",
  "Test plan",
  "Smoke impact",
  "Documentation impact",
  "Links",
];

const LOCAL_ONLY_PATTERNS = [
  { label: "/Users", pattern: /(^|[^\w])\/Users(?:\/|$)/ },
  { label: "/tmp", pattern: /(^|[^\w])\/tmp(?:\/|$)/ },
  { label: "file://", pattern: /file:\/\//i },
  { label: "worktrees/", pattern: /(^|[\s([`'"])worktrees\// },
];

function parseArgs(argv) {
  const args = {
    bodyFile: null,
    eventFile: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--body-file") {
      args.bodyFile = argv[i + 1];
      i += 1;
    } else if (arg === "--event-file") {
      args.eventFile = argv[i + 1];
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`check-pr-body.mjs

Usage:
  node scripts/hooks/check-pr-body.mjs
  node scripts/hooks/check-pr-body.mjs --body-file <path>
  node scripts/hooks/check-pr-body.mjs --event-file <github-event-json>
`);
}

function readBody(args) {
  if (args.bodyFile) {
    return fs.readFileSync(args.bodyFile, "utf8");
  }

  const eventName = process.env.GITHUB_EVENT_NAME || "";
  if (eventName !== "pull_request") {
    console.log(
      `SKIP: PR body check only runs on pull_request events (event=${eventName || "unknown"})`,
    );
    return null;
  }

  const eventPath = args.eventFile || process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error(
      "GITHUB_EVENT_PATH is required for pull_request validation",
    );
  }

  const payload = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const body = payload?.pull_request?.body;
  return typeof body === "string" ? body : "";
}

function normalizeHeading(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function collectHeadings(lines) {
  const headings = [];

  lines.forEach((line, index) => {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) {
      return;
    }
    headings.push({
      name: normalizeHeading(match[1]),
      line: index + 1,
      index,
    });
  });

  return headings;
}

function findSection(lines, headings, sectionName) {
  const wanted = normalizeHeading(sectionName);
  const headingIndex = headings.findIndex((heading) => heading.name === wanted);
  if (headingIndex === -1) {
    return null;
  }

  const start = headings[headingIndex];
  const next = headings[headingIndex + 1];
  return {
    line: start.line,
    content: lines.slice(start.index + 1, next ? next.index : lines.length),
  };
}

function hasNonPlaceholderValue(value) {
  const trimmed = value.trim();
  return trimmed.length > 0 && !/^<.*>$/.test(trimmed);
}

function hasField(section, fieldName) {
  const pattern = new RegExp(
    `^\\s*(?:-\\s*)?${escapeRegex(fieldName)}\\s*:\\s*(.*)$`,
    "i",
  );
  return section.content.some((line) => {
    const match = line.match(pattern);
    return match ? hasNonPlaceholderValue(match[1]) : false;
  });
}

function documentationRequiredIsValid(section) {
  const requiredLine = section.content.find((line) =>
    /^\s*-\s*Required\s*:/i.test(line),
  );
  if (!requiredLine) {
    return false;
  }
  const value = requiredLine
    .replace(/^\s*-\s*Required\s*:\s*/i, "")
    .trim()
    .toLowerCase();
  return value === "yes" || value === "no";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateLocalPaths(body) {
  const errors = [];
  const lines = body.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const localPattern of LOCAL_ONLY_PATTERNS) {
      if (localPattern.pattern.test(line)) {
        errors.push(
          `Local-only path is not allowed: ${localPattern.label} (line ${index + 1})`,
        );
      }
    }
  });

  return errors;
}

function validateBody(body) {
  const errors = [];
  const lines = body.split(/\r?\n/);
  const headings = collectHeadings(lines);
  const sections = new Map();

  for (const sectionName of REQUIRED_SECTIONS) {
    const section = findSection(lines, headings, sectionName);
    if (!section) {
      errors.push(`Missing required section: ${sectionName}`);
    } else {
      sections.set(sectionName, section);
    }
  }

  const smokeImpact = sections.get("Smoke impact");
  if (smokeImpact && !hasField(smokeImpact, "Smoke-Test-Plan")) {
    errors.push("Missing required field: Smoke impact / Smoke-Test-Plan");
  }

  const documentationImpact = sections.get("Documentation impact");
  if (documentationImpact) {
    const documentationFields = [
      "Required",
      "Trigger",
      "Updated SOT",
      "Reason",
    ];
    for (const fieldName of documentationFields) {
      if (!hasField(documentationImpact, fieldName)) {
        errors.push(
          `Missing required field: Documentation impact / ${fieldName}`,
        );
      }
    }
    if (!documentationRequiredIsValid(documentationImpact)) {
      errors.push("Documentation impact / Required must be yes or no");
    }
  }

  errors.push(...validateLocalPaths(body));
  return errors;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const body = readBody(args);

  if (body === null) {
    process.exit(0);
  }

  const errors = validateBody(body);
  if (errors.length > 0) {
    console.error("FAIL: PR body contract violation");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("PASS: PR body contract satisfied");
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exit(1);
}
