import { describe, expect, it } from "vitest";
import {
  checkLedger,
  loadReportExitCode,
  parseLedger,
  reportPathFor,
} from "../check-parity-ledger.js";

const LEDGER = `<!-- schemaVersion: 1 -->

# Fixture parity ledger

## Target results

| Target | Command | Pass | Fail | Blocked | Exit | Outcome |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Browser | \`pnpm parity -- --target web --out .runtime/fixture-web\` | 67 | 0 | 0 | 0 | Executed and green. |
| Desktop Linux | \`pnpm parity -- --target desktop --out .runtime/fixture-desktop\` | 66 | 0 | 1 | 2 | One row is registry-excluded. |

## Verdict

A fixture.
`;

const REPORTS: Record<string, { summary: Record<string, number> }> = {
  [reportPathFor("pnpm parity -- --target web --out .runtime/fixture-web")]: {
    summary: { pass: 67, fail: 0, blocked: 0 },
  },
  [reportPathFor("pnpm parity -- --target desktop --out .runtime/fixture-desktop")]: {
    summary: { pass: 66, fail: 0, blocked: 1 },
  },
};

function reader(reports: Record<string, unknown> = REPORTS) {
  return (path: string) => (path in reports ? reports[path] : null);
}

describe("check-parity-ledger", () => {
  it("should accept a ledger whose every cell matches its report", async () => {
    expect(await checkLedger(LEDGER, reader())).toEqual([]);
  });

  it("should fail when a ledger cell disagrees with its report", async () => {
    const edited = LEDGER.replace("| 66 | 0 | 1 | 2 |", "| 65 | 0 | 1 | 2 |");
    const findings = await checkLedger(edited, reader());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.target).toBe("Desktop Linux");
    expect(findings[0]?.cell).toBe("Pass");
    expect(findings[0]?.message).toMatch(/records 65, but .*fixture-desktop.*reports 66/u);
  });

  it("should fail when a ledger names a report that does not exist", async () => {
    const findings = await checkLedger(LEDGER, reader({}));
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.target)).toEqual(["Browser", "Desktop Linux"]);
    for (const finding of findings) {
      expect(finding.cell).toBe("Command");
      expect(finding.message).toMatch(/does not exist, so no cell in this row is traceable/u);
    }
  });

  it("should recompute exit from summary rather than trust the recorded value", async () => {
    // The exact desktop row of docs/verification/parity-2026-08-10-r2.md.
    const r2 = LEDGER.replace(
      "| Desktop Linux | `pnpm parity -- --target desktop --out .runtime/fixture-desktop` | 66 | 0 | 1 | 2 |",
      "| Desktop Linux | `TN_RUNTIME=$PWD/packages/runtime-native/build/tn-linux/mystral pnpm parity -- --target desktop --reference artifacts/conformance/web --out .runtime/parity-desktop3` | 66 | 0 | 1 | 0 |",
    );
    const findings = await checkLedger(r2, reader());
    const exitFinding = findings.find((finding) => finding.cell === "Exit");
    expect(exitFinding?.target).toBe("Desktop Linux");
    expect(exitFinding?.message).toBe(
      "records exit 0, but a summary of 66 pass / 0 fail / 1 blocked exits 2. " +
        "The runner cannot emit the recorded value.",
    );
  });

  it("recomputes exit with the runner's own rule, not a copy of it", async () => {
    const exitRule = await loadReportExitCode();
    expect(exitRule({ summary: { pass: 66, fail: 0, blocked: 1 } })).toBe(2);
    expect(exitRule({ summary: { pass: 65, fail: 1, blocked: 1 } })).toBe(1);
    expect(exitRule({ summary: { pass: 67, fail: 0, blocked: 0 } })).toBe(0);
  });

  it("fails closed on a table it cannot parse or one with no rows", () => {
    expect(() => parseLedger("# no target results section\n")).toThrow(
      /TN_PARITY_LEDGER_UNPARSEABLE/u,
    );
    expect(() =>
      parseLedger("## Target results\n\n| Target | Pass |\n| --- | ---: |\n| Browser | 67 |\n"),
    ).toThrow(/target table header is/u);
    expect(() =>
      parseLedger(
        "## Target results\n\n| Target | Command | Pass | Fail | Blocked | Exit | Outcome |\n" +
          "| --- | --- | ---: | ---: | ---: | ---: | --- |\n",
      ),
    ).toThrow(/needs a header, a separator and at least one row/u);
    expect(() =>
      parseLedger(
        "## Target results\n\n| Target | Command | Pass | Fail | Blocked | Exit | Outcome |\n" +
          "| --- | --- | ---: | ---: | ---: | ---: | --- |\n" +
          "| Browser | `pnpm parity` | many | 0 | 0 | 0 | Fine. |\n",
      ),
    ).toThrow(/column Pass is not a count/u);
  });

  it("resolves a relative --out the way the runner's outputLayout does", () => {
    expect(reportPathFor("pnpm parity -- --target desktop --out .runtime/parity-desktop3")).toMatch(
      /packages\/runtime-native\/\.runtime\/parity-desktop3\/report\.json$/u,
    );
    expect(reportPathFor("pnpm parity -- --target web")).toMatch(
      /packages\/runtime-native\/artifacts\/conformance\/web\/report\.json$/u,
    );
    expect(reportPathFor("pnpm parity -- --target desktop --out /tmp/one.json")).toBe(
      "/tmp/one.json",
    );
  });
});
