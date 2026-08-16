import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sealedProofFiles } from "../make-sandbox.js";

/**
 * PRD-113: a sealed proof must observe behaviour, not test whether the builder guessed a word.
 *
 * A builder sees `brief.md` and `reference.png` and never the proof. So any string value the
 * proof requires must either appear in the brief as a literal, or be one alternative among
 * several so the natural encoding also satisfies it. A bare `equals: "<unpublished string>"`
 * is unsatisfiable except by luck, and a round-8 arm lost two rows to exactly that: the proof
 * wanted `replayPhase` to equal "done" and `replayMatch` to equal the string "match" while the
 * build produced "complete" and boolean true with a correct, hash-identical replay.
 *
 * This walks **every genre** and **whole scenarios**, not physics-puzzle's `assert.resources`.
 * The first version of this gate did the narrow thing and missed five tokens, including
 * `assert.states[0].equals = "won"` sitting in the other scenario of the very genre it examined.
 * `sealed-contract.spec.ts` cannot catch those either: it classifies pins as identifier, key,
 * resource-id, resource-path or seed, and a pinned *value* is none of those.
 */
const GENRES = [
  "physics-puzzle",
  "platformer",
  "topdown-action",
  "endless-runner",
  "exploration",
  "open-world",
] as const;
const GENRE_ROOT = path.resolve("docs/benchmark/genres");

/** One pinned string, and the key that pinned it. */
interface IStringPin {
  readonly key: "equals" | "textIncludes";
  readonly value: string;
}

/**
 * One decision point in a scenario: a bare assertion, or an `anyOf` group of alternatives.
 * A group with **no** string pin among its alternatives is satisfiable without guessing.
 */
interface IPinGroup {
  readonly path: string;
  readonly alternatives: readonly (IStringPin | undefined)[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringPin(record: Record<string, unknown>): IStringPin | undefined {
  if (typeof record.equals === "string") return { key: "equals", value: record.equals };
  if (typeof record.textIncludes === "string")
    return { key: "textIncludes", value: record.textIncludes };
  return undefined;
}

function collectGroups(value: unknown, current: string, groups: IPinGroup[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectGroups(entry, `${current}[${index}]`, groups));
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.anyOf)) {
    groups.push({
      path: `${current}.anyOf`,
      alternatives: value.anyOf.map((alternative) =>
        isRecord(alternative) ? stringPin(alternative) : undefined,
      ),
    });
    return;
  }
  const pin = stringPin(value);
  if (pin !== undefined) groups.push({ path: current, alternatives: [pin] });
  for (const [key, entry] of Object.entries(value)) {
    collectGroups(entry, current === "" ? key : `${current}.${key}`, groups);
  }
}

/** Prose mentioning the word does not publish it; the brief has to name it as a literal. */
function publishedInBrief(token: string, text: string): boolean {
  return new RegExp(`[\`"']${token.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[\`"']`, "u").test(
    text,
  );
}

/**
 * A group is guessable only when every alternative pins a string and none of those strings is
 * published. One non-string alternative — `equals: true`, a `gte`, a `changed` — is enough,
 * because the natural encoding then satisfies the row without the builder knowing any vocabulary.
 */
function guessableTokens(group: IPinGroup, brief: string): string[] {
  const satisfiableWithoutGuessing = group.alternatives.some(
    (pin) => pin === undefined || publishedInBrief(pin.value, brief),
  );
  if (satisfiableWithoutGuessing) return [];
  return group.alternatives.flatMap((pin) =>
    pin === undefined ? [] : [`${group.path} ${pin.key}=${JSON.stringify(pin.value)}`],
  );
}

function auditGenre(genre: string): string[] {
  const brief = readFileSync(path.join(GENRE_ROOT, genre, "brief.md"), "utf8");
  const proofDirectory = path.join(GENRE_ROOT, genre, "proof");
  return readdirSync(proofDirectory)
    .filter((file) => file.endsWith(".json"))
    .flatMap((file) => {
      const groups: IPinGroup[] = [];
      collectGroups(
        JSON.parse(readFileSync(path.join(proofDirectory, file), "utf8")) as unknown,
        "",
        groups,
      );
      return groups.flatMap((group) =>
        guessableTokens(group, brief).map((token) => `${genre}/${file}: ${token}`),
      );
    });
}

describe("sealed proof tokens", () => {
  it.each(GENRES)("requires no string token the %s brief never publishes", (genre) => {
    expect(auditGenre(genre)).toEqual([]);
  });

  it("covers every genre the scaffolder seals, so a new genre inherits the gate", () => {
    for (const genre of GENRES) {
      expect(sealedProofFiles(process.cwd(), genre).length).toBeGreaterThan(0);
    }
    expect(readdirSync(GENRE_ROOT).filter((entry) => !entry.includes("."))).toEqual(
      expect.arrayContaining([...GENRES]),
    );
  });

  it("accepts the natural boolean encoding of a matching replay", () => {
    const groups: IPinGroup[] = [];
    collectGroups(
      JSON.parse(
        readFileSync(
          path.join(GENRE_ROOT, "physics-puzzle/proof/physics-puzzle-replay.playtest.json"),
          "utf8",
        ),
      ) as unknown,
      "",
      groups,
    );
    const replayMatch = groups.find((group) => group.path.endsWith("anyOf"));

    // A build that reports `replayMatch: true` is the obvious correct implementation and must
    // pass. The boolean alternative is what exempts the group, so the string "match" beside it
    // is a convenience rather than a vocabulary requirement.
    expect(replayMatch).toBeDefined();
    expect(replayMatch?.alternatives).toContain(undefined);
  });

  it("does not pin a terminal phase token", () => {
    const replay = JSON.parse(
      readFileSync(
        path.join(GENRE_ROOT, "physics-puzzle/proof/physics-puzzle-replay.playtest.json"),
        "utf8",
      ),
    ) as { assert?: { resources?: Array<{ equals?: unknown; path?: string }> } };
    const phase = (replay.assert?.resources ?? []).find(
      (assertion) => assertion.path === "replayPhase",
    );

    // `changed` is the behaviour — a game that never runs a replay leaves the phase alone and
    // still fails. The specific word it lands on is the game's business.
    expect(phase).toBeDefined();
    expect(phase?.equals).toBeUndefined();
  });
});
