import { describe, expect, it } from "vitest";
import { deriveCampaign } from "../engine-load-test/campaign.js";
import { buildDraftPlan } from "../engine-load-test/plan.js";
import { renderCampaignReport } from "../engine-load-test/report-html.js";
import type { IV2RunRecord } from "../engine-load-test/report-v2.js";

describe("offline campaign report", () => {
  const plan = buildDraftPlan();

  it("renders all six families and every missing cell without external assets", () => {
    const dataset = deriveCampaign(plan, [], { epsilonByCellId: {}, seed: 449 });
    const { html, csv, json } = renderCampaignReport(dataset);
    expect(dataset.rows).toHaveLength(73);
    expect(html).toContain("PARTIAL — required measured evidence");
    expect(html).toContain("not-run: <strong>");
    expect(html).toContain("<th>Attempts / evidence</th>");
    expect(html).toContain('href="#evidence-0-0"');
    expect(html).toContain('<details id="evidence-0-0">');
    for (const family of new Set(plan.cells.map((cell) => cell.family))) {
      expect(html).toContain(`<h2>${family}</h2>`);
    }
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/u);
    expect(csv.split("\n").filter((line) => line.startsWith('"arm",'))).toHaveLength(
      dataset.coverage.planned,
    );
    expect(JSON.parse(json)).toEqual(dataset);
    expect(renderCampaignReport(dataset)).toEqual({ html, csv, json });
  });

  it("uses the same run median for its table, chart and CSV, and escapes hostile text", () => {
    const cell = structuredClone(plan.cells[0]);
    if (cell === undefined) throw new Error("missing test cell");
    cell.id = "evil</script><img src=x onerror=alert(1)>";
    cell.experiment.variant = "static<script>alert(1)</script>";
    cell.sourceUrl = "javascript:alert(1)";
    const records = cell.plannedBlocks.flatMap(
      ({ block, session }) =>
        ["tn-desktop", "bevy-desktop"].map((armId, order) => ({
          arm: {
            id: armId,
            flags: { note: "</script><img src=x onerror=alert(1)>" },
            build: { hash: "a".repeat(64), type: "release" },
            version: "1",
            backend: "gpu",
          },
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
          order,
          outcome: { runStatus: "valid" },
          planHash: "plan",
          runId: `${armId}-${block}`,
          session,
          sourceHash: "source",
        })) as unknown as IV2RunRecord[],
    );
    (records[0] as IV2RunRecord).checksums = { "runs/../evil": "a".repeat(64) };
    const dataset = deriveCampaign({ status: "draft", cells: [cell] }, records, {
      epsilonByCellId: {},
      seed: 449,
    });
    const { html, csv } = renderCampaignReport(dataset);
    expect(html).toContain("10.00 ms mean");
    expect(html).toContain("20.00 ms mean");
    expect(html).toContain("2.00×");
    expect(html).toContain("width:50.00%");
    expect(html).toContain("width:100.00%");
    expect(csv).toContain('"tn-desktop","valid","10"');
    expect(csv).toContain('"bevy-desktop","valid","20"');
    expect(html).toContain("evil&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("unsafe artifact ref");
    expect(html).not.toContain('href="runs/../evil"');
    expect(html).not.toContain('href="javascript:alert(1)"');
  });
});
