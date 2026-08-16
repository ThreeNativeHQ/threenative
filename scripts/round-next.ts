import fs from "node:fs";
import path from "node:path";
import { readManifest } from "./make-sandbox.js";
import { type RoundArm, latestRoundFile, readRoundLedger } from "./round-ledger.js";

const REPO = path.resolve(import.meta.dirname, "..");

export interface RoundNextAction {
  readonly command: string;
  readonly reason: string;
}

function archivePath(archive: string, repo: string): string | undefined {
  if (archive === "unmeasured" || archive === "None" || archive === "n/a") return undefined;
  return path.isAbsolute(archive) ? archive : path.resolve(repo, archive);
}

function captureExists(archive: string): boolean {
  return fs.existsSync(path.join(archive, "captures", "index.json"));
}

function proofPasses(archive: string): boolean {
  const proofFile = path.join(archive, "proof.json");
  if (!fs.existsSync(proofFile)) return false;
  try {
    const proof = JSON.parse(fs.readFileSync(proofFile, "utf8")) as {
      passed?: unknown;
      scenarios?: unknown;
      total?: unknown;
    };
    const passed = typeof proof.passed === "number" ? proof.passed : undefined;
    const total = typeof proof.total === "number" ? proof.total : undefined;
    return (
      passed !== undefined &&
      total !== undefined &&
      Number.isInteger(passed) &&
      Number.isInteger(total) &&
      total > 0 &&
      passed === total &&
      Array.isArray(proof.scenarios) &&
      proof.scenarios.length === total &&
      proof.scenarios.every(
        (scenario) =>
          typeof scenario === "object" &&
          scenario !== null &&
          !Array.isArray(scenario) &&
          (scenario as { verdict?: unknown }).verdict === "pass",
      )
    );
  } catch {
    return false;
  }
}

function candidate(command: string, reason: string): RoundNextAction {
  return { command, reason };
}

/**
 * The next per-arm action, in arm order, when several arms each need one.
 *
 * A paired round has two arms by construction, so any defect that affects both produces two
 * candidates — the healthy shape of a round where neither arm has been proved is exactly the
 * shape a plural-is-ambiguous guard rejects. Round 8 was the first ledger to reach this path
 * (rounds 3-7 short-circuited earlier or had no two failing arms), and it turned the loop's own
 * "what next" command into a throw.
 *
 * Per-arm work is sequential, not exclusive: proving the vanilla arm does not stop you proving
 * the framework arm. So this returns the first and says how many remain rather than refusing to
 * answer. Nothing is skipped and the count is reported, so the caller still gets one unambiguous
 * command to run next.
 */
function firstOf(candidates: RoundNextAction[]): RoundNextAction | undefined {
  const [first, ...rest] = candidates;
  if (first === undefined || rest.length === 0) return first;
  const plural = rest.length === 1 ? "" : "s";
  return {
    command: first.command,
    reason: `${first.reason} ${rest.length} further arm action${plural} follow${rest.length === 1 ? "s" : ""} it.`,
  };
}

function archiveLabel(arm: RoundArm): string {
  return arm.archive === "unmeasured" ? `<${arm.arm}-archive>` : arm.archive;
}

function notePath(notes: string, label: string): string | undefined {
  const line = notes.split(/\r?\n/u).find((item) => item.trimStart().startsWith(`${label}:`));
  return line?.slice(line.indexOf(":") + 1).trim();
}

function openPrd(repo: string, prd: string): boolean {
  if (!/^PRD-\d+$/u.test(prd)) return false;
  const directory = path.join(repo, "docs", "PRDs");
  if (!fs.existsSync(directory)) return false;
  const fileName = fs
    .readdirSync(directory)
    .find((file) => file === `${prd}.md` || (file.startsWith(`${prd}-`) && file.endsWith(".md")));
  if (fileName === undefined) return false;
  const file = path.join(directory, fileName);
  const statusMatch = fs.readFileSync(file, "utf8").match(/^\*\*Status:\*\*\s*(.+)$/mu);
  const status = statusMatch?.[1]?.toLowerCase();
  return status === undefined || !/\b(?:complete|completed|closed|done)\b/u.test(status);
}

export function nextRoundAction(repo = REPO, ledgerFile = latestRoundFile(repo)): RoundNextAction {
  const ledger = readRoundLedger(ledgerFile);
  if (ledger.stopCondition !== "none yet")
    return candidate(
      `stop round ${ledger.round}`,
      `Stop condition recorded: ${ledger.stopCondition}. Resolve it before resuming the round.`,
    );
  const candidates: RoundNextAction[] = [];
  for (const arm of ledger.arms) {
    if (arm.archive === "pending") {
      if (candidates.length === 0)
        candidates.push(
          candidate(
            `pnpm sandbox --bare --arm ${arm.arm} --genre ${arm.genre}`,
            `Build the pending ${arm.arm} arm for ${arm.genre} after the earlier arm is complete.`,
          ),
        );
      continue;
    }
    const resolved = archivePath(arm.archive, repo);
    if (resolved === undefined) {
      candidates.push(
        candidate(
          `pnpm sandbox --bare --arm ${arm.arm} --genre ${arm.genre}`,
          `Build the missing ${arm.arm} arm for ${arm.genre}.`,
        ),
      );
      continue;
    }
    if (!fs.existsSync(resolved))
      throw new Error(`Round ledger names missing archive '${resolved}'.`);
    const manifestFile = path.join(resolved, "sweep.json");
    if (!fs.existsSync(manifestFile))
      throw new Error(`Round archive is missing sweep.json: ${resolved}`);
    const manifest = readManifest(manifestFile);
    if (manifest.arm !== arm.arm || manifest.genre !== arm.genre)
      throw new Error(`Round archive '${resolved}' contradicts its ledger arm or genre.`);
    if (!proofPasses(resolved))
      candidates.push(
        candidate(`pnpm sweep:proof ${arm.archive}`, `Prove the ${arm.arm} ${arm.genre} archive.`),
      );
    else if (!captureExists(resolved))
      candidates.push(
        candidate(
          `pnpm sweep:capture ${arm.archive}`,
          `Capture guarded frames for the ${arm.arm} ${arm.genre} archive.`,
        ),
      );
  }

  const first = firstOf(candidates);
  if (first !== undefined) return first;

  const unmeasuredVisual = ledger.arms.some((arm) => arm.instrumentVisual === "unmeasured");
  if (unmeasuredVisual) {
    const bundle = notePath(ledger.notes, "Blind bundle");
    const critic = notePath(ledger.notes, "Critic input");
    if (bundle === undefined || critic === undefined)
      throw new Error(
        `${ledgerFile}: name Blind bundle and Critic input before asking for a judge.`,
      );
    return candidate(
      `pnpm sweep:judge ${bundle} --input ${critic}`,
      "Judge the fresh blind image bundle.",
    );
  }

  const needsPair = ledger.columns.some((row) =>
    [row.functional, row.cost].some((value) => value === "unmeasured"),
  );
  if (needsPair) {
    const armsByGenre = new Map<string, RoundArm[]>();
    for (const arm of ledger.arms)
      armsByGenre.set(arm.genre, [...(armsByGenre.get(arm.genre) ?? []), arm]);
    const pair = [...armsByGenre.entries()].find(([, arms]) => arms.length === 2);
    if (pair === undefined)
      throw new Error(`${ledgerFile}: cannot pair a genre without both arms.`);
    const framework = pair[1].find((arm) => arm.arm === "framework");
    const vanilla = pair[1].find((arm) => arm.arm === "vanilla");
    if (framework === undefined || vanilla === undefined)
      throw new Error(`${ledgerFile}: cannot pair a genre without framework and vanilla arms.`);
    return candidate(
      `pnpm sweep:pair ${archiveLabel(framework)} ${archiveLabel(vanilla)}`,
      `Pair the ${pair[0]} arms before deciding gaps.`,
    );
  }

  const undecidedGap = ledger.gaps.find(
    (gap) => !ledger.dispositions.some((row) => row.gap === gap.number),
  );
  if (undecidedGap !== undefined)
    return candidate(
      `record disposition for gap #${undecidedGap.number}`,
      `Decide whether gap #${undecidedGap.number} is framework change, user space, or rejected.`,
    );

  const missingPrd = ledger.dispositions.find(
    (row) => row.disposition === "framework change" && !/^PRD-\d+$/u.test(row.prd),
  );
  if (missingPrd !== undefined)
    return candidate(
      `write the PRD named by gap #${missingPrd.gap}`,
      "A framework change needs a numbered PRD before implementation.",
    );

  if (ledger.gates.some((gate) => gate.result !== "pass"))
    return candidate(
      "pnpm typecheck && pnpm lint && pnpm test && pnpm budgets",
      "Run the four required gates before closing the round.",
    );

  const activePrd = ledger.dispositions.find((row) => openPrd(repo, row.prd));
  if (activePrd !== undefined)
    return candidate(
      `implement ${activePrd.prd}`,
      `${activePrd.prd} is still open for gap #${activePrd.gap}; re-measure before closing the round.`,
    );

  return candidate(
    `close round ${ledger.round}`,
    "All evidence and dispositions are recorded; close the round.",
  );
}

function main(): void {
  const action = nextRoundAction();
  process.stdout.write(`${action.command}\n${action.reason}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
