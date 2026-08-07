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
});
