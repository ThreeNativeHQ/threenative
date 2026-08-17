import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NO_STOP_CONDITION, parseRoundLedger, validateRoundLedger } from "../round-ledger.js";

function ledger(overrides: string[] = []): string {
  return [
    "# Improvement round ledger — round 1 — 2026-08-06",
    "",
    "Round: 1",
    "Date: 2026-08-06",
    "Framework commit: working tree",
    "Framework version: 0.1.0",
    "Genres: platformer",
    "Budget: one bounded implementation slice",
    "Stop condition met: none yet",
    "Next action: close round 1",
    "",
    "## Arms",
    "",
    "| Genre | Arm | Archive | Brief SHA-256 | Proof SHA-256 | Proof passed/total | Instrument visual | User LOC | Source files | Reach rate |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| platformer | framework | docs/framework | brief | proof | 2/2 | 4 | 100 | 2 | 0.5 |",
    "| platformer | vanilla | docs/vanilla | brief | proof | 2/2 | 4 | 176 | 2 | n/a |",
    "",
    "## Column verdicts",
    "",
    "| Genre | Functional | Visual | Cost | Verdict |",
    "| --- | --- | --- | --- | --- |",
    "| platformer | tie | tie | win | parity or better |",
    "",
    "## Gap list",
    "",
    "| # | Genre | Column | What vanilla did better | Evidence | Smallest change that would close it |",
    "| --- | --- | --- | --- | --- | --- |",
    "| None | None | None | None | None | None |",
    "",
    "## Dispositions",
    "",
    "| Gap # | Disposition | 20-line verdict | Named live caller | PRD | Reason if rejected |",
    "| --- | --- | --- | --- | --- | --- |",
    "| None | None | None | None | None | None |",
    "",
    "## Deletions this round",
    "",
    "| Export | Rounds unreached | Deleted? | Evidence |",
    "| --- | --- | --- | --- |",
    "| None | 0 | no — no completed prior round to compare | unmeasured |",
    "",
    "## Gates",
    "",
    "| Gate | Command | Result |",
    "| --- | --- | --- |",
    "| Typecheck | pnpm typecheck | pass |",
    "| Lint | pnpm lint | pass |",
    "| Test | pnpm test | pass |",
    "| Budgets | pnpm budgets | pass |",
    "",
    "## Firewall attestation",
    "",
    "| Rule | Held? | Evidence |",
    "| --- | --- | --- |",
    "| Arms built in separate contexts | yes | builder-a and builder-b |",
    "| Neither builder saw the sealed proofs | yes | proofs copied after builds |",
    "| Judge was fresh, read-only, blind to arm | yes | external reveal and critic |",
    "| Lead agent wrote no game code | yes | only orchestration changes |",
    "",
    "## Notes",
    "",
    "All evidence is recorded in the named archives.",
    ...overrides,
  ].join("\n");
}

interface ProofAssertion {
  readonly id: string;
  readonly pass: boolean;
}

interface ProofScenario {
  readonly assertions: readonly ProofAssertion[];
}

interface ProofRecord {
  readonly scenarios: readonly ProofScenario[];
}

const ROUND_7 = path.resolve(process.cwd(), "docs/verification/round-7-2026-08-15.md");
const SCORE_ROUND_7 = path.resolve(
  process.cwd(),
  "docs/verification/score-physics-puzzle-round-7-2026-08-15.md",
);

async function readProof(archive: string): Promise<ProofRecord> {
  const proofPath = path.resolve(process.cwd(), `docs/benchmark/sweeps/${archive}/proof.json`);
  return JSON.parse(await readFile(proofPath, "utf8")) as ProofRecord;
}

function consistentOutcome(proof: ProofRecord, id: string): boolean {
  const outcomes = proof.scenarios.map((scenario, index) => {
    const matches = scenario.assertions.filter((assertion) => assertion.id === id);
    expect(matches, `${id} assertion count in scenario ${index + 1}`).toHaveLength(1);
    const assertion = matches[0];
    if (assertion === undefined)
      throw new Error(`Missing ${id} assertion in scenario ${index + 1}.`);
    return assertion.pass;
  });
  expect(new Set(outcomes), `${id} outcomes across scenarios`).toHaveLength(1);
  const outcome = outcomes[0];
  if (outcome === undefined) throw new Error(`Missing ${id} proof outcome.`);
  return outcome;
}

async function publishedOutcomeSummary(arm: string, archive: string): Promise<string> {
  const proof = await readProof(archive);
  const seed = consistentOutcome(proof, "world.seed");
  const diagnostics = consistentOutcome(proof, "diagnostics");
  return `${arm} arm ${seed ? "passed" : "failed"} \`world.seed\` and ${diagnostics ? "passed" : "failed"} diagnostics`;
}

describe("round ledger schema", () => {
  it("accepts a complete, bounded ledger", () => {
    expect(validateRoundLedger(ledger()).round).toBe(1);
  });

  it("rejects the placeholder template", async () => {
    const template = await readFile(
      path.join(process.cwd(), ".claude/skills/self-improve/references/round-ledger-template.md"),
      "utf8",
    );
    expect(() => validateRoundLedger(template, "template.md")).toThrow(/placeholder|blank/u);
  });

  it("rejects mismatched hashes between arms", () => {
    expect(() =>
      validateRoundLedger(ledger().replace("| proof | 2/2", "| other-proof | 2/2")),
    ).toThrow(/mismatched proof hashes/u);
  });

  it("rejects a gap without exactly one disposition", () => {
    const withGap = ledger()
      .replace(
        "| None | None | None | None | None | None |",
        "| 1 | platformer | visual | clearer goal | captures | improve goal |",
      )
      .replace(
        "| None | None | None | None | None | None |",
        "| None | None | None | None | None | None |",
      );
    expect(() => validateRoundLedger(withGap, "gap.md")).toThrow(/every gap/u);
  });

  it("requires a void stop condition when the firewall fails", () => {
    // The fixture keeps the row's three cells. It used to drop one and trail a stray pipe, which
    // still reached the void check only because the table parser tolerated ragged rows.
    const invalid = ledger().replace(
      "| Arms built in separate contexts | yes | builder-a and builder-b |",
      "| Arms built in separate contexts | no | builder-a and builder-b |",
    );
    expect(() => validateRoundLedger(invalid, "void.md")).toThrow(/void/u);
  });

  it("keeps round 7 published outcomes derived from proof rows and retains VOID", async () => {
    const [round, score, frameworkSummary, vanillaSummary] = await Promise.all([
      readFile(ROUND_7, "utf8"),
      readFile(SCORE_ROUND_7, "utf8"),
      publishedOutcomeSummary("framework", "physics-puzzle-2026-08-15-4"),
      publishedOutcomeSummary("vanilla", "physics-puzzle-2026-08-15-3"),
    ]);

    for (const document of [round, score]) {
      const normalized = document.replace(/\s+/gu, " ");
      expect(normalized).toContain(frameworkSummary);
      expect(normalized).toContain(vanillaSummary);
    }
    expect(round).toMatch(/^Stop condition met: void$/mu);
    expect(round).toContain("| physics-puzzle | unmeasured | unmeasured | loss | void");
    expect(score).toMatch(/^\*\*Verdict: VOID\b/mu);
  });
});

describe("a round that declares no genres", () => {
  // Round 10 opens on the template visual floor rather than a paired build, so it carries no
  // Arms and no Column verdicts. `parseRoundLedger` demanded both, `latestRoundFile` picks the
  // newest ledger, and `pnpm round:next` — the loop's own "what next" command — threw before it
  // computed anything.
  //
  // The rule that keeps this fail-closed is that the absence must be **declared**. A ledger that
  // simply lost its `## Arms` heading still throws; only one whose `Genres` says so may omit it.
  function baseline(genres: string, sections: string[] = []): string {
    return [
      "# Improvement round ledger — round 10 — the template quality floor — 2026-08-16",
      "",
      "Round: 10",
      "Date: 2026-08-16",
      "Framework commit: 937085e1",
      "Framework version: 0.1.0",
      `Genres: ${genres}`,
      "Budget: not yet granted",
      "Stop condition met: none",
      "Next action: round 11 runs scripts/visual-ab.ts",
      "",
      ...sections,
      "## Gap list",
      "",
      "| # | Genre | Column | What vanilla did better | Evidence | Smallest change that would close it |",
      "| --- | --- | --- | --- | --- | --- |",
      "| None | None | None | None | None | None |",
      "",
      "## Dispositions",
      "",
      "| Gap # | Disposition | 20-line verdict | Named live caller | PRD | Reason if rejected |",
      "| --- | --- | --- | --- | --- | --- |",
      "| None | None | None | None | None | None |",
      "",
      "## Gates",
      "",
      "| Gate | Command | Result |",
      "| --- | --- | --- |",
      "| Typecheck | pnpm typecheck | pass |",
      "| Lint | pnpm lint | pass |",
      "| Test | pnpm test | pass |",
      "| Budgets | pnpm budgets | pass |",
      "",
      "## Notes",
      "",
      "The baseline and its gap list cost nothing further.",
      "",
    ].join("\n");
  }

  it("parses with no Arms and no Column verdicts", () => {
    const ledger = parseRoundLedger(
      baseline("none yet — this round opens on the template baseline rather than a paired build"),
    );
    expect(ledger.round).toBe(10);
    expect(ledger.arms).toEqual([]);
    expect(ledger.columns).toEqual([]);
    expect(ledger.stopCondition).toBe("none");
  });

  it("still throws when a round that names a genre is missing its Arms", () => {
    // The inverted control. Without it, "Arms may be absent" would be true of every ledger and
    // a section lost to a bad edit would parse as a round that measured nothing.
    expect(() => parseRoundLedger(baseline("platformer"))).toThrow(/missing '## Arms'/u);
  });

  it("parses the Arms a baseline round does carry, rather than assuming it has none", () => {
    const ledger = parseRoundLedger(
      baseline("none yet — see notes", [
        "## Arms",
        "",
        "| Genre | Arm | Archive | Brief SHA-256 | Proof SHA-256 | Proof passed/total | Instrument visual | User LOC | Source files | Reach rate |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        "| platformer | framework | docs/framework | brief | proof | 2/2 | 4 | 100 | 2 | 0.5 |",
        "| platformer | vanilla | docs/vanilla | brief | proof | 2/2 | 4 | 176 | 2 | n/a |",
        "",
      ]),
    );
    expect(ledger.arms.map((arm) => arm.arm)).toEqual(["framework", "vanilla"]);
  });

  it("refuses a paired round through validateRoundLedger even when it declares no genres", () => {
    // The write-time validator keeps its bar. Reading a baseline round is not the same as
    // blessing one as a completed paired round.
    expect(() => validateRoundLedger(baseline("none yet — baseline"), "round-10.md")).toThrow(
      /Arms table has no rows/u,
    );
  });

  it("reads only the section's own table, not a second one that follows it", () => {
    // Round 10's Dispositions section carries the disposition table and then a second table
    // comparing two shapes for an owner decision. `table()` collected every pipe line in the
    // section, so the second table's 3-cell rows were parsed as dispositions and round:next died
    // on a row "missing 'Named live caller'".
    const withSecondTable = baseline("none yet — baseline").replace(
      "| None | None | None | None | None | None |\n\n## Gates",
      [
        "| None | None | None | None | None | None |",
        "",
        "Two defensible shapes, recorded for the owner:",
        "",
        "| Shape | What ships | What it costs |",
        "| --- | --- | --- |",
        "| A | one HUD | native parity |",
        "",
        "## Gates",
      ].join("\n"),
    );

    const ledger = parseRoundLedger(withSecondTable);

    expect(ledger.dispositions).toEqual([]);
  });

  it("keeps an escaped pipe inside a cell instead of splitting on it", () => {
    // Round 5's gap list writes a regex alternation, applyImpulse\|applyForce\|setLinvel, which
    // is how markdown escapes a literal pipe. Splitting on every pipe turned one cell into five,
    // so the row read ten cells against a six-column header and every later column came from the
    // wrong place — silently, because the surplus cells were simply dropped.
    const escaped = baseline("none yet — baseline").replace(
      "| None | None | None | None | None | None |\n\n## Dispositions",
      "| 1 | platformer | Visual | grep for `applyImpulse\\|applyForce` returns nothing | captures | fix it |\n\n## Dispositions",
    );

    const [gap] = parseRoundLedger(escaped).gaps;

    expect(gap?.what).toBe("grep for `applyImpulse|applyForce` returns nothing");
    expect(gap?.evidence).toBe("captures");
  });

  it("refuses a row whose cell count does not match its header", () => {
    // The fail-closed half. Stopping at the first blank line means a malformed row can no longer
    // arrive from a neighbouring table; a malformed row inside the table itself must still throw
    // rather than yield an undefined cell.
    const ragged = baseline("none yet — baseline").replace(
      "| None | None | None | None | None | None |\n\n## Gates",
      "| None | None | None | None | None | None |\n| 1 | user space |\n\n## Gates",
    );
    expect(() => parseRoundLedger(ragged)).toThrow(/wrong number of cells/u);
  });

  it("reads 'none' and 'none yet' as the same absence of a stop condition", () => {
    // Round 10 writes `none`; the template writes `none yet`. Treating them differently made
    // round:next answer "stop round 10" for a round with nothing wrong with it.
    for (const spelling of ["none", "none yet"]) {
      const ledger = parseRoundLedger(
        baseline("none yet — baseline").replace(
          "Stop condition met: none",
          `Stop condition met: ${spelling}`,
        ),
      );
      expect(NO_STOP_CONDITION.has(ledger.stopCondition)).toBe(true);
    }
  });
});

describe("visual deltas and the resolution they are read against", () => {
  function withDeltas(mde: string, rows: readonly string[]): string {
    return ledger([
      "",
      `Visual MDE: ${mde}`,
      "",
      "## Visual deltas",
      "",
      "| Template | Before | After | Δ | Verdict |",
      "| --- | --- | --- | --- | --- |",
      ...rows,
    ]);
  }

  it("accepts a delta that clears the measured resolution", () => {
    const parsed = validateRoundLedger(withDeltas("1", ["| shooter | 2 | 4 | +2 | WIN |"]));
    expect(parsed.visualMde).toBe(1);
    expect(parsed.visualDeltas).toEqual([
      { after: 4, before: 2, delta: 2, template: "shooter", verdict: "WIN" },
    ]);
  });

  it("refuses a sub-resolution delta reported as a win", () => {
    // Round 10's `defense +1` against a floor of 1. Its prose said the row was unattributable and
    // its table said `+1`; the table is what a reader quotes.
    expect(() => validateRoundLedger(withDeltas("1", ["| defense | 2 | 3 | +1 | WIN |"]))).toThrow(
      /defense.*cannot resolve it.*INDETERMINATE, not 'WIN'/su,
    );
  });

  it("refuses a sub-resolution delta reported as a loss, including the minus sign markdown uses", () => {
    expect(() => validateRoundLedger(withDeltas("1", ["| racing | 3 | 2 | −1 | LOSS |"]))).toThrow(
      /racing.*INDETERMINATE, not 'LOSS'/su,
    );
  });

  it("accepts the same sub-resolution delta once it is recorded INDETERMINATE", () => {
    const parsed = validateRoundLedger(
      withDeltas("1", ["| racing | 3 | 2 | −1 | INDETERMINATE |"]),
    );
    expect(parsed.visualDeltas[0]?.delta).toBe(-1);
  });

  it("refuses a delta table with no stated resolution", () => {
    const noMde = ledger([
      "",
      "## Visual deltas",
      "",
      "| Template | Before | After | Δ | Verdict |",
      "| --- | --- | --- | --- | --- |",
      "| shooter | 2 | 4 | +2 | WIN |",
    ]);
    expect(() => validateRoundLedger(noMde)).toThrow(/needs a 'Visual MDE:' field/u);
  });

  it("refuses a delta that does not equal after minus before", () => {
    // Arithmetic nobody checks is how a hand-edited table stops describing its own scores.
    expect(() => validateRoundLedger(withDeltas("0", ["| shooter | 2 | 4 | +1 | WIN |"]))).toThrow(
      /is 1, which is not 4 − 2/u,
    );
  });

  it("leaves a round that ran no visual comparison alone", () => {
    const parsed = validateRoundLedger(ledger());
    expect(parsed.visualMde).toBeNull();
    expect(parsed.visualDeltas).toEqual([]);
  });
});
