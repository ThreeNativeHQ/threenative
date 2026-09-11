/**
 * Which families of checks a change needs, and which CI job belongs to which family.
 *
 * One module so the classifier and the `ci-required` verdict cannot disagree. A verdict computed
 * from a second copy of this table is the failure mode the whole selective board has to avoid:
 * a job the classifier deselected but the verdict still demands blocks every merge, and a job the
 * verdict forgot is a gate nobody watches.
 *
 * Fail closed everywhere. A path no rule recognises selects every family, and a job missing from
 * `CI_JOB_SELECTION` is a fault rather than an exemption.
 */

/** Every family, in the order a run summary should read them. */
export const CHECK_FAMILIES = Object.freeze([
  "docs",
  "workspace",
  "browser",
  "playtest",
  "templates",
  "native",
  "site",
]);

/** The selection a path no rule recognises produces: all of it. */
export function allFamilies() {
  return new Set(CHECK_FAMILIES);
}

/**
 * Markdown that an executable fixture, parser or gate reads. Editing one of these is a code
 * change wearing a `.md` extension, so it selects everything.
 */
const EXECUTABLE_MARKDOWN = [
  /^docs\/PRDs\/realism-effects\/README\.md$/u,
  /^docs\/verification\/(?:PRD-289-conventions|alpha-bar|runtime-perf-state)\.md$/u,
  /^docs\/verification\/realism-effects-ao(?:-|\.)/u,
  /^docs\/verification\/worker-wake(?:-|\.)/u,
  /^docs\/verification\/native-(?:runtime-)?(?:census|coverage)(?:-|\.)/u,
  /^docs\/verification\/(?:round-|parity-|sweep-|tier-1-)/u,
];

/** Markdown roots whose contents no gate executes: planning prose and evidence records. */
const INERT_PROSE_ROOTS = ["docs/PRDs/", "docs/verification/"];

function isAgentInstruction(file) {
  return /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u.test(file);
}

/**
 * One path's rule: the families it selects and why.
 *
 * Order matters — the first rule that recognises the path owns it, and the last rule recognises
 * everything, so there is no path without a decision.
 */
export function pathSelection(file) {
  if (EXECUTABLE_MARKDOWN.some((pattern) => pattern.test(file))) {
    return {
      families: CHECK_FAMILIES,
      reason: "Markdown an executable fixture, parser or gate reads",
    };
  }
  if (isAgentInstruction(file)) {
    // A template's instructions ship to the user inside the scaffold, so they are a scaffold
    // input, not repository prose: the template lanes and the native starter read them.
    if (file.startsWith("packages/create-threenative/templates/")) {
      return { families: CHECK_FAMILIES, reason: "agent instructions shipped inside a template" };
    }
    return {
      families: ["docs", "workspace"],
      reason: "agent instructions and their generated mirror",
    };
  }
  if (file.endsWith(".md")) {
    if (INERT_PROSE_ROOTS.some((root) => file.startsWith(root))) {
      return { families: ["docs"], reason: "inert planning or evidence prose" };
    }
    if (file.startsWith("docs/") || !file.includes("/")) {
      return {
        families: ["docs", "workspace"],
        reason: "repository prose the workspace suite reads",
      };
    }
    return { families: CHECK_FAMILIES, reason: "Markdown outside the documented prose roots" };
  }
  if (file.startsWith("site/")) {
    return {
      families: ["docs", "workspace", "site"],
      reason: "the isolated website, whose own workflow builds, types and tests it",
    };
  }
  return { families: CHECK_FAMILIES, reason: "a path no narrowing rule covers" };
}

/**
 * The selection a set of changed paths produces.
 *
 * Returns the union of every path's families plus the reason each family was selected, naming the
 * first path that demanded it — a reader has to be able to see *why* the native matrix is running.
 */
export function selectFamilies(files) {
  const families = new Set();
  const reasons = [];
  let broadenedBy;
  for (const file of files) {
    const selection = pathSelection(file);
    if (broadenedBy === undefined && selection.families.length === CHECK_FAMILIES.length) {
      broadenedBy = `${JSON.stringify(file)} is ${selection.reason}`;
    }
    for (const family of selection.families) {
      if (families.has(family)) continue;
      families.add(family);
      reasons.push({ family, file, reason: selection.reason });
    }
  }
  return { broadenedBy, families, reasons };
}

/**
 * Every job in `ci.yml`, and what selects it.
 *
 * `family: null` is a job that runs on every selection — the decision job itself, the two
 * always-evaluated joins that report their own applicability, and the secret scan, which has to
 * see a Markdown-only change because Markdown can carry a credential.
 *
 * `events` narrows a job to the events its own `if:` admits, so a nightly run is not failed for a
 * job that correctly skipped itself.
 */
export const CI_JOB_SELECTION = Object.freeze({
  benchmark: { family: "workspace" },
  build: { family: null },
  "build-artifacts": { family: "workspace" },
  budgets: { family: "workspace" },
  "golden-path": { family: null },
  "golden-path-template": { family: "templates" },
  lint: { family: null },
  "native-platforms": { family: "native" },
  "performance-contracts": { family: "workspace" },
  scope: { family: null },
  "supply-chain": { events: ["pull_request", "push"], family: null },
  "template-nonvisual": { family: "templates" },
  test: { family: "workspace" },
  "test-browser": { family: "browser" },
  "test-native": { family: "native" },
  "test-playtest": { family: "playtest" },
  "test-unit": { family: "workspace" },
  typecheck: { family: "workspace" },
});

/** Jobs that report on the board rather than gate it, so the verdict does not wait on them. */
export const CI_REPORTING_JOBS = Object.freeze(["ci-required", "run-summary"]);

/**
 * Whether `job` is expected to run, given the selected families and the event.
 *
 * Throws on an unknown job: a job added to `ci.yml` and forgotten here must fail the verdict
 * loudly, never be exempted by silence.
 */
export function jobIsSelected(job, families, eventName) {
  const entry = CI_JOB_SELECTION[job];
  if (entry === undefined) {
    throw new Error(`CI_REQUIRED_UNKNOWN_JOB: ${job} has no entry in CI_JOB_SELECTION`);
  }
  if (entry.events !== undefined && !entry.events.includes(eventName)) return false;
  if (entry.family === null) return true;
  return families.has(entry.family);
}

/** The wire form the workflows gate on: `|docs|workspace|`, unambiguous under `contains()`. */
export function fenceFamilies(families) {
  const ordered = CHECK_FAMILIES.filter((family) => families.has(family));
  return `|${ordered.join("|")}|`;
}

/** The same set, for a human reading the run summary. */
export function listFamilies(families) {
  return CHECK_FAMILIES.filter((family) => families.has(family)).join(", ");
}

/** Parses the fenced wire form back into a set, fail-closed on an unknown family name. */
export function parseFamilies(fenced) {
  if (typeof fenced !== "string" || !fenced.startsWith("|") || !fenced.endsWith("|")) {
    throw new Error(`CI_REQUIRED_MALFORMED_FAMILIES: ${JSON.stringify(fenced)}`);
  }
  const names = fenced.slice(1, -1).split("|").filter(Boolean);
  const families = new Set();
  for (const name of names) {
    if (!CHECK_FAMILIES.includes(name)) {
      throw new Error(`CI_REQUIRED_MALFORMED_FAMILIES: unknown family '${name}'`);
    }
    families.add(name);
  }
  // A selection that runs nothing is not a cheap run, it is an unverified merge.
  if (families.size === 0) {
    throw new Error("CI_REQUIRED_MALFORMED_FAMILIES: the selection names no family");
  }
  return families;
}
