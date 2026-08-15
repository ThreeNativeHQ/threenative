import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PRD-113: a sealed proof must observe behaviour, not test whether the builder guessed a word.
 *
 * A builder sees `brief.md` and `reference.png` and never the proof. So any string value the
 * proof requires must either appear in the brief as a literal, or be one alternative among
 * several so the natural encoding also satisfies it. A bare `equals: "<unpublished string>"`
 * is unsatisfiable except by luck, and a round-8 arm lost two rows to exactly that: the proof
 * wanted `replayPhase` to equal "done" and `replayMatch` to equal the string "match" while the
 * build produced "complete" and boolean true with a correct, hash-identical replay.
 */
const GENRE_ROOT = path.resolve("docs/benchmark/genres/physics-puzzle");

interface IAlternative {
  equals?: unknown;
  path?: string;
}

interface IResourceAssertion extends IAlternative {
  anyOf?: IAlternative[];
}

function brief(): string {
  return readFileSync(path.join(GENRE_ROOT, "brief.md"), "utf8");
}

function proofScenario(file: string): { assert?: { resources?: IResourceAssertion[] } } {
  return JSON.parse(readFileSync(path.join(GENRE_ROOT, "proof", file), "utf8")) as {
    assert?: { resources?: IResourceAssertion[] };
  };
}

/** Prose mentioning the word does not publish it; the brief has to name it as a literal. */
function publishedInBrief(token: string, text: string): boolean {
  return new RegExp(`[\`"']${token.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}[\`"']`, "u").test(
    text,
  );
}

function guessableTokens(assertion: IResourceAssertion, text: string): string[] {
  const alternatives = assertion.anyOf ?? [assertion];
  const satisfiableWithoutGuessing = alternatives.some(
    (alternative) =>
      typeof alternative.equals !== "string" || publishedInBrief(alternative.equals, text),
  );
  if (satisfiableWithoutGuessing) return [];
  return alternatives.flatMap((alternative) =>
    typeof alternative.equals === "string" ? [`${alternative.path}=${alternative.equals}`] : [],
  );
}

describe("sealed physics-puzzle proof", () => {
  it("requires no string token the brief never publishes", () => {
    const text = brief();
    const offenders = ["physics-puzzle.playtest.json", "physics-puzzle-replay.playtest.json"]
      .flatMap((file) =>
        (proofScenario(file).assert?.resources ?? []).flatMap((assertion) =>
          guessableTokens(assertion, text).map((token) => `${file}: ${token}`),
        ),
      );

    expect(offenders).toEqual([]);
  });

  it("accepts the natural boolean encoding of a matching replay", () => {
    const replayMatch = (proofScenario("physics-puzzle-replay.playtest.json").assert?.resources ??
      []).find((assertion) =>
      (assertion.anyOf ?? [assertion]).some((alternative) => alternative.path === "replayMatch"),
    );

    const accepted = (replayMatch?.anyOf ?? []).map((alternative) => alternative.equals);
    // A build that reports `replayMatch: true` is the obvious correct implementation and must
    // pass. A build whose two replays disagreed reports false, which none of these accept.
    expect(accepted).toContain(true);
    expect(accepted).not.toContain(false);
  });

  it("does not pin a terminal phase token", () => {
    const phase = (proofScenario("physics-puzzle-replay.playtest.json").assert?.resources ?? [])
      .find((assertion) => assertion.path === "replayPhase");

    // `changed` is the behaviour — a game that never runs a replay leaves the phase alone and
    // still fails. The specific word it lands on is the game's business.
    expect(phase).toBeDefined();
    expect(phase?.equals).toBeUndefined();
  });
});
