import fs from "node:fs";
import path from "node:path";
import { inspectFrame } from "./capture-guard.js";
import { readManifest } from "./make-sandbox.js";
import {
  NO_STOP_CONDITION,
  type RoundArm,
  latestRoundFile,
  readRoundLedger,
} from "./round-ledger.js";

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

function visualArchiveTemplates(archive: string, arm: string, ledgerFile: string): Set<string> {
  if (!fs.existsSync(archive) || !fs.statSync(archive).isDirectory())
    throw new Error(
      `${ledgerFile}: visual-only ${arm} archive is missing screenshot evidence: ${archive}`,
    );
  const imageFiles = fs
    .readdirSync(archive, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"));
  if (imageFiles.length === 0)
    throw new Error(
      `${ledgerFile}: visual-only ${arm} archive is missing screenshot evidence: ${archive}`,
    );
  for (const entry of imageFiles) {
    const file = path.join(archive, entry.name);
    try {
      inspectFrame(fs.readFileSync(file));
    } catch (error) {
      throw new Error(
        `${ledgerFile}: visual-only ${arm} archive contains invalid image bytes: ${file} (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  return new Set(imageFiles.map((entry) => path.parse(entry.name).name));
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

/**
 * Finds a PRD anywhere under `docs/PRDs`, excluding `done/`.
 *
 * A non-recursive read was correct only while every PRD sat at the top level. PRDs are grouped
 * into batch folders once a night's work is assembled, and from that moment an open PRD in one
 * read as *not found* — which this function reports as *not open*, so the loop advanced to
 * `close round N` with the blocker still open. `done/` stays excluded: a PRD archived there is
 * finished whatever its status line still says.
 */
function findPrd(directory: string, prd: string): string | undefined {
  if (!fs.existsSync(directory)) return undefined;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "done") continue;
      const found = findPrd(path.join(directory, entry.name), prd);
      if (found !== undefined) return found;
      continue;
    }
    if (
      entry.name === `${prd}.md` ||
      (entry.name.startsWith(`${prd}-`) && entry.name.endsWith(".md"))
    )
      return path.join(directory, entry.name);
  }
  return undefined;
}

function openPrd(repo: string, prd: string): boolean {
  if (!/^PRD-\d+$/u.test(prd)) return false;
  const file = findPrd(path.join(repo, "docs", "PRDs"), prd);
  if (file === undefined) return false;
  const statusMatch = fs.readFileSync(file, "utf8").match(/^\*\*Status:\*\*\s*(.+)$/mu);
  const status = statusMatch?.[1]?.toLowerCase();
  return status === undefined || !/\b(?:complete|completed|closed|done)\b/u.test(status);
}

export function nextRoundAction(repo = REPO, ledgerFile = latestRoundFile(repo)): RoundNextAction {
  const ledger = readRoundLedger(ledgerFile);
  if (!NO_STOP_CONDITION.has(ledger.stopCondition))
    return candidate(
      `stop round ${ledger.round}`,
      `Stop condition recorded: ${ledger.stopCondition}. Resolve it before resuming the round.`,
    );
  if (ledger.declaresVisualOnly) {
    if (ledger.visualDeltas.length === 0 || ledger.visualMde === null)
      throw new Error(
        `${ledgerFile}: visual-only round requires a nonempty Visual deltas measurement and numeric Visual MDE.`,
      );
    const templatesByArm = new Map<string, Set<string>>();
    for (const arm of ledger.arms) {
      const resolved = archivePath(arm.archive, repo);
      if (resolved === undefined)
        throw new Error(
          `${ledgerFile}: visual-only ${arm.arm} archive is missing screenshot evidence: ${arm.archive}.`,
        );
      templatesByArm.set(arm.arm, visualArchiveTemplates(resolved, arm.arm, ledgerFile));
    }
    for (const delta of ledger.visualDeltas) {
      for (const arm of ["before", "after"] as const) {
        if (!templatesByArm.get(arm)?.has(delta.template))
          throw new Error(
            `${ledgerFile}: visual-only archive is missing ${arm} image for visual delta '${delta.template}'.`,
          );
      }
    }
  }
  const candidates: RoundNextAction[] = [];
  for (const arm of ledger.arms) {
    // A visual-only round's before/after directories contain screenshots, not sweep archives.
    // Their evidence is read from the visual delta section and must never be treated as a
    // framework or vanilla build that needs proof, capture, or a sweep manifest.
    if (ledger.declaresVisualOnly) continue;
    if (arm.archive === "pending") {
      if (candidates.length === 0)
        candidates.push(
          candidate(
            `pnpm sandbox --bare --arm ${arm.arm} --genre ${arm.genre} --name ${arm.genre}-${arm.arm}`,
            `Build the pending ${arm.arm} arm for ${arm.genre} after the earlier arm is complete.`,
          ),
        );
      continue;
    }
    const resolved = archivePath(arm.archive, repo);
    if (resolved === undefined) {
      candidates.push(
        candidate(
          `pnpm sandbox --bare --arm ${arm.arm} --genre ${arm.genre} --name ${arm.genre}-${arm.arm}`,
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

  const unmeasuredVisual =
    !ledger.declaresVisualOnly && ledger.arms.some((arm) => arm.instrumentVisual === "unmeasured");
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
  // A ledger this refuses is a refusal, not a crash. It used to print a Node stack trace over the
  // one sentence naming what was wrong with the ledger, which reads as a broken tool rather than a
  // working guard.
  try {
    const action = nextRoundAction();
    process.stdout.write(`${action.command}\n${action.reason}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
