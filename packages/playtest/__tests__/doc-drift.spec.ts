import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLAYTEST_ASSERTION_REGISTRY } from "../src/assertions.js";
import { PLAYTEST_ROOT_KEYS, PLAYTEST_STEP_KEYS } from "../src/scenario.js";
import { renderAssertionReference } from "../../../scripts/generate-assertion-reference.js";

/**
 * The documentation-drift gate (report §4.3): documentation that teaches scenario
 * vocabulary the validator rejects is the holdFrames incident repeating — the wrong
 * spelling survived every session that hit it because no test read the docs against
 * the validator. Both directions are checked:
 *
 * 1. within the sections that teach scenario authoring (the templates' playtest
 *    sections and the fail-closed page), every backtick-quoted camelCase key must be
 *    accepted by the real validator or carry a reasoned exception below;
 * 2. every assertion kind the registry ships must be named somewhere in those docs —
 *    an assertion type no doc mentions is one agents cannot discover.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Backtick tokens that appear inside playtest-teaching sections but are prose,
 * engine exports, lifecycle names or commands rather than scenario schema keys.
 * Every entry needs a reason; if you are adding one because the gate caught a real
 * drift, fix the doc instead.
 */
const PROSE_TOKENS: Readonly<Record<string, string>> = {
  accent: "render palette name",
  acceptHotUpdate: "engine core export quoted by the hot-reload rule",
  attachToBone: "engine core export named in the capability table",
  clearance: "GroundSnap field quoted from the capability table",
  createRandom: "engine core export",
  createReplayDriver: "engine core export",
  ctx: "the game-side context object, not scenario JSON",
  defineGame: "engine core export",
  document: "DOM global named by the portability rules",
  enter: "scene lifecycle method",
  exit: "scene lifecycle method",
  flatShading: "three.js material property",
  getPlatform: "engine core export",
  goto: "ctx method",
  initialState: "game state shape name",
  interact: "n/a",
  intersectRay: "physics space-state method",
  isMobile: "engine core export",
  isNative: "engine core export",
  isTouchscreenAvailable: "engine core export",
  isWeb: "engine core export",
  lerp: "math shorthand in prose",
  lint: "repo command name",
  load: "scene lifecycle method",
  localStorage: "DOM global named by the portability rules",
  minimal: "template name in prose",
  normalBias: "three.js light property",
  normaliseToMetres: "engine core export",
  player: "entity id used by examples, not a schema key",
  playerX: "game state field used by examples",
  prewarm: "engine core export",
  recast: "physics navigation export",
  render: "scene lifecycle method",
  replay: "engine core export",
  roundedBox: "template shapes helper",
  return: "JavaScript keyword quoted in a code rule",
  skeletonBones: "engine core export",
  softCircleDataTexture: "engine core export",
  starter: "template name in prose",
  state: "the game state resource id, not a step/assertion key",
  three: "library name in prose",
  typecheck: "repo command name",
  update: "scene lifecycle method",
};

/** The playtest-teaching slice of a markdown document: headings that name playtests
 * through to the next heading of the same or higher level. */
function playtestSections(content: string): string {
  const lines = content.split("\n");
  const collected: string[] = [];
  let inside = false;
  let level = 0;
  for (const line of lines) {
    const heading = /^(#{1,6}) (.+)$/u.exec(line);
    if (heading !== null) {
      const isBoundary = inside && (heading[1]?.length ?? 0) <= level;
      if (isBoundary) inside = false;
      if (!inside && /playtest/i.test(heading[2] ?? "")) {
        inside = true;
        level = heading[1]?.length ?? 1;
        collected.push(line);
        continue;
      }
    }
    if (inside) collected.push(line);
  }
  return collected.join("\n");
}

/** The documents that teach scenario authoring: every template's playtest sections,
 * the shared fail-closed fragment they render from, and the generated assertion
 * reference. General engine reference pages (ctx cookbook, capture recipes, asset
 * loop) teach other vocabularies and are deliberately out of scope. */
async function teachingDocuments(): Promise<{ path: string; content: string }[]> {
  const scaffoldRoot = path.join(repoRoot, "packages/create-threenative");
  const documents: { path: string; content: string }[] = [];
  const templates = await readdir(path.join(scaffoldRoot, "templates"), { withFileTypes: true });
  for (const template of templates.filter((entry) => entry.isDirectory())) {
    const agents = path.join(scaffoldRoot, "templates", template.name, "AGENTS.md");
    documents.push({
      path: path.relative(repoRoot, agents),
      content: playtestSections(await readFile(agents, "utf8")),
    });
  }
  for (const page of ["playtest-fail-closed.md", "references/assertion-reference.md"]) {
    const absolute = path.join(scaffoldRoot, "agent-docs", page);
    documents.push({ path: path.relative(repoRoot, absolute), content: await readFile(absolute, "utf8") });
  }
  return documents;
}

function acceptedSchemaKeys(): Set<string> {
  const keys = new Set<string>([...PLAYTEST_ROOT_KEYS, ...PLAYTEST_STEP_KEYS]);
  for (const entry of PLAYTEST_ASSERTION_REGISTRY) {
    keys.add(entry.kind);
    for (const field of entry.fields) keys.add(field.name);
  }
  return keys;
}

const CAMEL_TOKEN = /`([a-z][a-zA-Z0-9]+)`/gu;

describe("playtest documentation drift", () => {
  it("never teaches a scenario key the validator rejects", async () => {
    const accepted = acceptedSchemaKeys();
    const offenders: string[] = [];
    for (const document of await teachingDocuments()) {
      for (const match of document.content.matchAll(CAMEL_TOKEN)) {
        const token = match[1];
        if (token === undefined) continue;
        if (accepted.has(token) || PROSE_TOKENS[token] !== undefined) continue;
        offenders.push(`${token} (${document.path})`);
      }
    }
    expect(
      offenders,
      `docs teach keys the validator rejects — fix the doc or add the key to the validator: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("names every assertion kind the registry ships", async () => {
    const documents = await teachingDocuments();
    const unmentioned = PLAYTEST_ASSERTION_REGISTRY.filter((entry) => {
      const pattern = new RegExp(`(?:^|[^A-Za-z0-9_$])${entry.kind}(?![A-Za-z0-9_$])`, "u");
      return !documents.some((document) => pattern.test(document.content));
    }).map((entry) => entry.kind);
    expect(
      unmentioned,
      `assertion kinds absent from every teaching doc: ${unmentioned.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the committed reference generated from the registry", async () => {
    const reference = (await teachingDocuments()).find(({ path: documentPath }) =>
      documentPath.endsWith("agent-docs/references/assertion-reference.md"),
    );
    expect(reference).toBeDefined();
    expect(reference?.content, "assertion reference is stale; run the reference generator").toBe(
      renderAssertionReference(PLAYTEST_ASSERTION_REGISTRY),
    );
  });
});
