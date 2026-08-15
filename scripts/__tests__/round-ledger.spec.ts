import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateRoundLedger } from "../round-ledger.js";

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
    const invalid = ledger().replace(
      "| Arms built in separate contexts | yes |",
      "| Arms built in separate contexts | no |\n|",
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
