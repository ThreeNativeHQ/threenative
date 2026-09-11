import { describe, expect, it } from "vitest";

import { progressOf, readSections } from "../prd-progress.js";

/** The shape that caused the 2026-09-08 stall: acceptance boxes only, no phase boxes. */
const ACCEPTANCE_ONLY = `# PRD-365 — consumer desktop distribution

### Phase 1 — a game command creates a container

**Implementation and wiring:** prose only, no boxes.

## Acceptance criteria

- [ ] Each claimed desktop OS has a relocatable container.
- [ ] Signed Windows and notarized macOS artifacts are verified.
`;

const TWO_PHASES = `# PRD-x

### Phase 1 — first

- [x] wire the caller
- [x] required test green

### Phase 2 — second

- [ ] wire the caller
- [ ] required test green

## Acceptance criteria

- [ ] the whole thing works
`;

const FINISHED = TWO_PHASES.replaceAll("- [ ]", "- [x]");

describe("readSections", () => {
  it("should attribute boxes to the phase heading above them", () => {
    const sections = readSections(TWO_PHASES);
    const phases = sections.filter((section) => section.kind === "phase");
    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({ ticked: 2, total: 2 });
    expect(phases[1]).toMatchObject({ ticked: 0, total: 2 });
  });

  it("should keep acceptance boxes out of the phase tally", () => {
    const acceptance = readSections(TWO_PHASES).filter((s) => s.kind === "acceptance");
    expect(acceptance).toHaveLength(1);
    expect(acceptance[0]).toMatchObject({ ticked: 0, total: 1 });
  });
});

describe("progressOf", () => {
  it("should report zero phases for a PRD whose only boxes are acceptance criteria", () => {
    // The caller turns this into a non-zero exit; it must never be reported as progress.
    expect(progressOf(ACCEPTANCE_ONLY)).toMatchObject({ percent: 0, phases: 0 });
  });

  it("should bucket one of two verified phases at 50% orange", () => {
    expect(progressOf(TWO_PHASES).label).toEqual({ color: "#e36209", name: "prd:50%" });
  });

  it("should hold at 75% yellow while every phase is in but acceptance is open", () => {
    const phasesDone = TWO_PHASES.replace("- [ ] wire the caller", "- [x] wire the caller").replace(
      "- [ ] required test green",
      "- [x] required test green",
    );
    const progress = progressOf(phasesDone);
    expect(progress.phasesComplete).toBe(progress.phases);
    expect(progress.acceptanceTicked).toBeLessThan(progress.acceptanceTotal);
    expect(progress.label).toEqual({ color: "#fbca04", name: "prd:75%" });
  });

  it("should only reach 100% green when phases and acceptance are both ticked", () => {
    expect(progressOf(FINISHED).label).toEqual({ color: "#0e8a16", name: "prd:100% — ready" });
  });

  it("should refuse to reach 100% when a PRD has no acceptance criteria to satisfy", () => {
    const noAcceptance = FINISHED.slice(0, FINISHED.indexOf("## Acceptance criteria"));
    expect(progressOf(noAcceptance).percent).toBe(75);
  });
});
