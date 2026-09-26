import { describe, expect, it } from "vitest";
import { deriveCampaign } from "../engine-load-test/campaign.js";
import { type IPlannedCell, buildDraftPlan } from "../engine-load-test/plan.js";
import type { IV2RunRecord } from "../engine-load-test/report-v2.js";

function run(cell: IPlannedCell, armId: string, block: number, status = "valid") {
  return {
    arm: { id: armId, build: { type: "release" } },
    block,
    campaignHash: "campaign",
    campaignId: "campaign-1",
    comparability: "matched-task",
    experiment: cell.experiment,
    fixture: { hash: "fixture" },
    machine: { id: "desktop", gpu: "gpu", lane: "physical-hardware" },
    metrics: [
      { name: "completed-work-mean-ms", unit: "ms", value: armId === "tn-desktop" ? 10 : 20 },
    ],
    order: armId === "tn-desktop" ? 0 : 1,
    outcome: { runStatus: status },
    planHash: "plan",
    runId: `${cell.id}-${armId}-${block}`,
    session: block < 5 ? 1 : 2,
  } as unknown as IV2RunRecord;
}

describe("campaign derivation", () => {
  const cells = [
    buildDraftPlan().cells.find((cell) => cell.id.startsWith("bevy-many-cubes.static.1000.")),
    buildDraftPlan().cells.find((cell) => cell.id.startsWith("godot-culling.basic_cull.")),
  ] as IPlannedCell[];
  const plan = { status: "draft" as const, cells };
  const first = cells[0] as IPlannedCell;

  it("keeps every planned arm visible when the bundle is empty", () => {
    const result = deriveCampaign(plan, [], { seed: 449, epsilonByCellId: {} });
    expect(result.rows).toHaveLength(2);
    expect(result.coverage).toMatchObject({ planned: 4, attempted: 0, notRun: 4 });
    expect(result.partial).toBe(true);
    expect(result.rows[0]?.comparisons[0]).toMatchObject({
      comparability: "non-comparable",
      reason: "incomplete paired arm coverage",
      statistics: null,
    });
  });

  it("derives a ratio only from seven complete pairs and keeps other cells missing", () => {
    const records = first.plannedBlocks.flatMap(({ block }) => [
      run(first, "tn-desktop", block),
      run(first, "bevy-desktop", block),
    ]);
    const result = deriveCampaign(plan, records, {
      seed: 449,
      epsilonByCellId: { [first.id]: 0.03 },
    });
    expect(result.coverage).toMatchObject({ planned: 4, attempted: 2, valid: 2, notRun: 2 });
    expect(result.rows[0]?.comparisons[0]?.statistics?.ratio).toBeCloseTo(2);
    expect(result.rows[0]?.comparisons[0]?.statistics?.verdict).toBe("insufficient");
    expect(result.partial).toBe(true);
    expect(result.planStatus).toBe("draft");

    const missing = deriveCampaign(
      plan,
      records.filter((record) => record.runId !== `${first.id}-bevy-desktop-3`),
      {
        seed: 449,
        epsilonByCellId: { [first.id]: 0.03 },
      },
    );
    expect(missing.rows[0]?.comparisons[0]?.statistics).toBeNull();
    expect(missing.coverage.invalid).toBe(1);
  });

  it("retains failures and rejects out-of-plan or reused records", () => {
    const failed = deriveCampaign(plan, [run(first, "bevy-desktop", 1, "crashed")], {
      seed: 1,
      epsilonByCellId: {},
    });
    expect(failed.coverage.failed).toBe(1);
    expect(failed.rows[0]?.arms.find((arm) => arm.id === "bevy-desktop")?.status).toBe("failed");
    const original = run(first, "bevy-desktop", 1);
    const alien = { ...original, arm: { ...original.arm, id: "alien" } };
    expect(() => deriveCampaign(plan, [alien], { seed: 1, epsilonByCellId: {} })).toThrow(
      /unplanned arm/u,
    );
    const record = run(first, "bevy-desktop", 1);
    expect(() => deriveCampaign(plan, [record, record], { seed: 1, epsilonByCellId: {} })).toThrow(
      /reused runId/u,
    );
  });

  it("keeps software-renderer smoke runs out of publication ratios", () => {
    const software = first.plannedBlocks.flatMap(({ block }) =>
      ["tn-desktop", "bevy-desktop"].map((armId) => {
        const record = run(first, armId, block);
        return { ...record, machine: { ...record.machine, lane: "hosted-software" as const } };
      }),
    );
    const result = deriveCampaign(plan, software, { seed: 449, epsilonByCellId: {} });
    expect(result.coverage.invalid).toBe(2);
    expect(result.rows[0]?.comparisons[0]?.statistics).toBeNull();
  });

  it("refuses a frozen plan that omits required cells or comparison arms", () => {
    const records = first.plannedBlocks.flatMap(({ block }) => [
      run(first, "tn-desktop", block),
      run(first, "bevy-desktop", block),
    ]);
    expect(() =>
      deriveCampaign({ status: "frozen", cells: [first] }, records, {
        seed: 449,
        epsilonByCellId: { [first.id]: 0.03 },
      }),
    ).toThrow(/frozen plan omitted required cell/u);

    const full = buildDraftPlan();
    const incompleteArm = structuredClone(full.cells);
    const firstThreeArm = incompleteArm.find((cell) => cell.arms.length === 3);
    if (firstThreeArm === undefined) throw new Error("missing three-arm cell");
    firstThreeArm.arms.pop();
    expect(() =>
      deriveCampaign({ status: "frozen", cells: incompleteArm }, [], {
        seed: 449,
        epsilonByCellId: {},
      }),
    ).toThrow(/frozen plan omitted required arm/u);

    const revised = structuredClone(full.cells);
    for (const cell of revised) cell.experiment.fixtureRevision = "frozen-1";
    expect(() =>
      deriveCampaign({ status: "frozen", cells: revised }, [], {
        seed: 449,
        epsilonByCellId: {},
      }),
    ).toThrow(/unresolved actual census/u);
    for (const cell of revised) {
      for (const [name, count] of Object.entries(cell.upstreamActual)) {
        if (count === null) cell.upstreamActual[name] = 1;
      }
    }
    expect(
      deriveCampaign({ status: "frozen", cells: revised }, [], {
        seed: 449,
        epsilonByCellId: {},
      }).partial,
    ).toBe(true);
  });
});
