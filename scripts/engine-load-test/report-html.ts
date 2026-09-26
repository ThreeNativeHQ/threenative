import type { IArmCoverage, ICampaignDataset, ICampaignRow } from "./campaign.js";
import { FRAME_INTERVAL_BINS_MS } from "./raw-series.js";
import { PRIMARY_METRIC } from "./report-v2.js";

const ARM_COLUMNS = [
  "tn-native",
  "tn-web",
  "plain-three-web",
  "bevy-desktop",
  "godot-desktop",
] as const;
const ARM_ID = { "tn-native": "tn-desktop" } as const;

function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] as string;
  });
}

function csv(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function number(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? (values[middle] as number)
    : ((values[middle - 1] as number) + (values[middle] as number)) / 2;
}

interface IArmValues {
  arm: string;
  attempts: number;
  mean: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  status: string;
}

function armValues(dataset: ICampaignDataset, arm: IArmCoverage): IArmValues {
  const eligible = arm.status === "valid" || arm.status === "qualified";
  const runIds = new Set(arm.runIds);
  const runs = eligible ? dataset.runs.filter((run) => runIds.has(run.runId)) : [];
  const metric = (name: string): number | null => {
    if (runs.length === 0) return null;
    const values = runs.map((run) => {
      const reported = run.metrics.find((entry) => entry.name === name)?.value;
      if (typeof reported === "number") return reported;
      if (!Object.hasOwn(dataset.rawTiming, run.runId)) return null;
      const raw = dataset.rawTiming[run.runId];
      if (name === "frame-p50-ms") return raw?.intervalP50Ms ?? null;
      if (name === "frame-p95-ms") return raw?.intervalP95Ms ?? null;
      if (name === "frame-p99-ms") return raw?.intervalP99Ms ?? null;
      return null;
    });
    return values.every((value) => typeof value === "number") ? median(values as number[]) : null;
  };
  return {
    arm: arm.id,
    attempts: arm.attempts,
    mean: metric(PRIMARY_METRIC),
    p50: metric("frame-p50-ms"),
    p95: metric("frame-p95-ms"),
    p99: metric("frame-p99-ms"),
    status: arm.status,
  };
}

function sourceLink(sourceUrl: string | null): string {
  if (sourceUrl === null) return "No upstream source URL in plan";
  try {
    const url = new URL(sourceUrl);
    if (url.protocol !== "https:" || url.hostname !== "github.com") return "Invalid source URL";
    return `<a href="${escapeHtml(url.href)}" rel="noopener noreferrer">Pinned upstream source</a>`;
  } catch {
    return "Invalid source URL";
  }
}

function artifactLink(ref: string): string {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9._-]+)*$/u.test(ref) ||
    ref.split("/").some((segment) => segment === "." || segment === "..")
  )
    return "unsafe artifact ref";
  return `<a href="${escapeHtml(ref)}">${escapeHtml(ref)}</a>`;
}

function counts(row: ICampaignRow): string {
  return Object.entries(row.cell.upstreamActual)
    .map(
      ([name, value]) =>
        `${escapeHtml(name)}: ${value === null ? "unmeasured" : escapeHtml(value)}`,
    )
    .join("; ");
}

function armCell(value: IArmValues | undefined): string {
  if (value === undefined) return "<td>—</td>";
  const status = escapeHtml(value.status);
  if (value.mean === null) return `<td><strong>${status}</strong><br>— ms</td>`;
  return `<td><strong>${status}</strong><br>${number(value.mean)} ms mean<br><small>p50 ${number(value.p50)} · p95 ${number(value.p95)} · p99 ${number(value.p99)} ms</small></td>`;
}

function comparisonCell(row: ICampaignRow): string {
  if (row.comparisons.length === 0) return "<td>—</td>";
  return `<td>${row.comparisons
    .map((comparison) => {
      const label = `${escapeHtml(comparison.left)} vs ${escapeHtml(comparison.right)}`;
      const result = comparison.statistics;
      if (result === null) {
        return `<div><strong>${label}</strong>: — (${escapeHtml(comparison.reason ?? "unmeasured")})</div>`;
      }
      const interval =
        result.ci95 === null
          ? "interval unavailable"
          : `95% CI ${number(result.ci95[0])}–${number(result.ci95[1])}`;
      return `<div><strong>${label}</strong>: ${number(result.ratio)}×; ${interval}; ${escapeHtml(result.verdict)}; ${escapeHtml(comparison.comparability)}; ${result.validBlocks} blocks</div>`;
    })
    .join("")}</td>`;
}

function timingTable(dataset: ICampaignDataset, runIds: ReadonlySet<string>): string {
  const rows = dataset.runs.flatMap((run) => {
    const timing = Object.hasOwn(dataset.rawTiming, run.runId)
      ? dataset.rawTiming[run.runId]
      : undefined;
    if (!runIds.has(run.runId) || timing === undefined || run.timing.rawSeries === null) return [];
    return [
      `<tr><th scope="row">${artifactLink(run.timing.rawSeries)}</th><td>${timing.frameCount}</td><td>${number(timing.intervalP50Ms)}</td><td>${number(timing.intervalP95Ms)}</td><td>${number(timing.intervalP99Ms)}</td><td>${number(timing.intervalMaxMs)}</td><td>${number(timing.finalDrainMs)}</td><td>${timing.hitchCount}</td><td>${timing.gpuSampleCount}/${timing.frameCount}</td><td>${timing.gpuMissingFrames}</td>${timing.histogram.map((count) => `<td>${count}</td>`).join("")}</tr>`,
    ];
  });
  if (rows.length === 0) return "<p>No retained frame-interval summary.</p>";
  const bins = FRAME_INTERVAL_BINS_MS.map((edge, index) =>
    index === 0
      ? `&lt;${number(edge)} ms`
      : `${number(FRAME_INTERVAL_BINS_MS[index - 1] as number)}–&lt;${number(edge)} ms`,
  );
  bins.push(`≥${number(FRAME_INTERVAL_BINS_MS.at(-1) as number)} ms`);
  return `<div class="scroll"><table><caption>Frame interval distribution by run. Intervals are render-producing boundaries; completed-work mean also includes the final completion wait, which is not a GPU timestamp. Hitches exceed twice that run’s median interval. A missing GPU timestamp is not zero GPU time.</caption><thead><tr><th>Raw series</th><th>Frames</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>Max ms</th><th>Final completion wait ms</th><th>Hitches &gt;2× median</th><th>GPU timestamp samples</th><th>Frames without GPU timestamp</th>${bins.map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function detail(dataset: ICampaignDataset, row: ICampaignRow, id: string): string {
  const runIds = new Set(row.arms.flatMap((arm) => arm.runIds));
  const runs = dataset.runs.filter((run) => runIds.has(run.runId));
  const runList =
    runs.length === 0
      ? "<p>No runs collected.</p>"
      : `<table><caption>All recorded attempts</caption><thead><tr><th>Run</th><th>Arm</th><th>Session/block</th><th>Outcome</th><th>Completed work mean</th><th>Build and settings</th></tr></thead><tbody>${runs
          .map((run) => {
            const mean =
              run.metrics.find((metric) => metric.name === PRIMARY_METRIC)?.value ?? null;
            const flags = Object.entries(run.arm.flags)
              .map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(value)}`)
              .join(", ");
            const recordRef = `runs/${run.runId}.json`;
            const artifacts = Object.keys(run.checksums ?? {})
              .map(artifactLink)
              .join(", ");
            return `<tr><td>${artifactLink(recordRef)}<br>${artifacts}</td><td>${escapeHtml(run.arm.id)}</td><td>${run.session}/${run.block}</td><td>${escapeHtml(run.outcome.runStatus)}</td><td>${number(mean)} ms</td><td>${escapeHtml(run.arm.version)} · ${escapeHtml(run.arm.backend)} · ${escapeHtml(run.arm.build.hash)}<br>${flags}</td></tr>`;
          })
          .join("")}</tbody></table>`;
  return `<details id="${id}"><summary>Evidence and settings for ${escapeHtml(row.cell.id)}</summary><p>${sourceLink(row.cell.sourceUrl)}. Requested: ${Object.entries(
    row.cell.requested,
  )
    .map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(value)}`)
    .join(", ")}. Actual: ${counts(row)}.</p>${runList}${timingTable(dataset, runIds)}</details>`;
}

function chart(dataset: ICampaignDataset, familyRows: ICampaignRow[]): string {
  const points = familyRows.flatMap((row) =>
    row.arms.map((arm) => ({ row, value: armValues(dataset, arm) })),
  );
  const observed = points.filter((point) => point.value.mean !== null);
  if (observed.length === 0)
    return "<p>No measured frame times yet; the table lists every planned load.</p>";
  const maximum = Math.max(...observed.map((point) => point.value.mean as number));
  return `<figure><figcaption>Completed-work mean by planned load and arm (ms; median of run means). Unmeasured loads are gaps.</figcaption><div class="chart">${points
    .map(({ row, value }) => {
      const label = `${row.cell.experiment.variant} · load ${row.cell.experiment.load} · ${value.arm}`;
      const width = value.mean === null ? 0 : (100 * value.mean) / maximum;
      return `<div class="plot-row"><span>${escapeHtml(label)}</span><span class="bar-track">${value.mean === null ? "" : `<span class="bar" style="width:${width.toFixed(2)}%"></span>`}</span><span>${number(value.mean)} ms</span></div>`;
    })
    .join("")}</div></figure>`;
}

function renderFamily(dataset: ICampaignDataset, family: string, familyIndex: number): string {
  const rows = dataset.rows.filter((row) => row.cell.family === family);
  const body = rows
    .map((row, rowIndex) => {
      const values = new Map(row.arms.map((arm) => [arm.id, armValues(dataset, arm)]));
      const cells = ARM_COLUMNS.map((arm) =>
        armCell(values.get(arm === "tn-native" ? ARM_ID[arm] : arm)),
      ).join("");
      const attempts = row.arms.map((arm) => `${escapeHtml(arm.id)}: ${arm.attempts}`).join("; ");
      return `<tr><th scope="row">${escapeHtml(row.cell.experiment.variant)}<br><small>load ${escapeHtml(row.cell.experiment.load)}</small></th><td>${escapeHtml(row.cell.experiment.optimizationClass)}<br>${escapeHtml(row.cell.experiment.renderingProfile)}<br>${escapeHtml(row.cell.experiment.protocol)}</td><td>${counts(row)}</td>${cells}${comparisonCell(row)}<td>${attempts}<br><a href="#evidence-${familyIndex}-${rowIndex}">Evidence and settings</a></td></tr>`;
    })
    .join("");
  return `<section id="${escapeHtml(family)}" data-family="${escapeHtml(family)}"><h2>${escapeHtml(family)}</h2>${chart(dataset, rows)}<div class="scroll"><table><caption>Planned cells, including missing and failed runs</caption><thead><tr><th>Variant / load</th><th>Class / profile / protocol</th><th>Actual counts</th>${ARM_COLUMNS.map((arm) => `<th>${escapeHtml(arm)}</th>`).join("")}<th>TN / competitor ratio</th><th>Attempts / evidence</th></tr></thead><tbody>${body}</tbody></table></div>${rows.map((row, rowIndex) => detail(dataset, row, `evidence-${familyIndex}-${rowIndex}`)).join("")}</section>`;
}

function renderCsv(dataset: ICampaignDataset): string {
  const header = [
    "kind",
    "cell",
    "family",
    "variant",
    "load",
    "arm",
    "status",
    "mean_ms",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "ratio",
    "ci_low",
    "ci_high",
    "verdict",
    "comparability",
  ];
  const rows: unknown[][] = [];
  for (const row of dataset.rows) {
    const base = [
      row.cell.id,
      row.cell.family,
      row.cell.experiment.variant,
      row.cell.experiment.load,
    ];
    for (const arm of row.arms) {
      const value = armValues(dataset, arm);
      rows.push([
        "arm",
        ...base,
        arm.id,
        arm.status,
        value.mean,
        value.p50,
        value.p95,
        value.p99,
        null,
        null,
        null,
        null,
        null,
      ]);
    }
    for (const comparison of row.comparisons) {
      const result = comparison.statistics;
      rows.push([
        "comparison",
        ...base,
        `${comparison.left}/${comparison.right}`,
        result === null ? "unmeasured" : result.verdict,
        null,
        null,
        null,
        null,
        result?.ratio ?? null,
        result?.ci95?.[0] ?? null,
        result?.ci95?.[1] ?? null,
        result?.verdict ?? null,
        comparison.comparability,
      ]);
    }
  }
  return `${[header, ...rows].map((row) => row.map(csv).join(",")).join("\n")}\n`;
}

/** All outputs come from one derived dataset; no network, external CSS, or external scripts. */
export function renderCampaignReport(dataset: ICampaignDataset): {
  html: string;
  csv: string;
  json: string;
} {
  const families = [...new Set(dataset.rows.map((row) => row.cell.family))];
  const coverage = dataset.coverage;
  const firstRun = dataset.runs[0];
  const builds = [
    ...new Set(
      dataset.runs.map(
        (run) =>
          `${run.arm.id}: ${run.arm.version} (${run.arm.backend}, build ${run.arm.build.hash}, source ${run.sourceHash})`,
      ),
    ),
  ];
  const provenance = `<p>Campaign ID: ${escapeHtml(firstRun?.campaignId ?? "unrecorded")}; date: ${escapeHtml(dataset.publicationMachine?.date ?? "unrecorded")}; machine: ${escapeHtml(dataset.publicationMachine?.id ?? firstRun?.machine.id ?? "unrecorded")}; OS: ${escapeHtml(dataset.publicationMachine?.os ?? firstRun?.machine.os ?? "unrecorded")}; CPU: ${escapeHtml(dataset.publicationMachine?.cpu ?? "unrecorded")}; GPU: ${escapeHtml(dataset.publicationMachine?.gpu ?? firstRun?.machine.gpu ?? "unrecorded")}; driver: ${escapeHtml(dataset.publicationMachine?.driver ?? "unrecorded")}.</p>${dataset.publicationGaps.length === 0 ? "" : `<p class="banner">Missing publication metadata: ${escapeHtml(dataset.publicationGaps.join(", "))}</p>`}<details><summary>Engine versions and build hashes</summary>${builds.length === 0 ? "<p>No runs collected.</p>" : `<ul>${builds.map((build) => `<li>${escapeHtml(build)}</li>`).join("")}</ul>`}</details>`;
  const summary = [
    "planned",
    "attempted",
    "valid",
    "qualified",
    "invalid",
    "failed",
    "unsupported",
    "notRun",
  ] as const;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ThreeNative cross-engine campaign</title><style>
  :root{font-family:system-ui,sans-serif;color:#182536;background:#f7f9fc}body{max-width:1600px;margin:auto;padding:1rem 2rem;line-height:1.5}a{color:#174e92}a:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #b34d00;outline-offset:3px}h1,h2{line-height:1.2}header{border-bottom:3px solid #203d67;margin-bottom:2rem}.banner{padding:.8rem 1rem;background:#fff0d1;border-left:5px solid #a05200;font-weight:700}.complete{background:#d9f3dc;border-color:#167536}.counts{display:flex;flex-wrap:wrap;gap:.6rem}.counts span{background:white;padding:.5rem;border:1px solid #b9c7d7;border-radius:.3rem}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;background:white}th,td{border:1px solid #b9c7d7;padding:.5rem;vertical-align:top;text-align:left}thead{background:#e3ebf6}tbody tr:nth-child(even){background:#f5f8fc}small{font-size:.78rem}section{margin:3rem 0}details{margin:.5rem 0;border:1px solid #b9c7d7;background:white;padding:.4rem}.chart{background:white;padding:1rem}.plot-row{display:grid;grid-template-columns:minmax(13rem,2fr) minmax(5rem,4fr) 5rem;gap:.5rem;margin:.15rem 0;font-size:.8rem}.bar-track{background:#eef2f7}.bar{display:block;height:1.2rem;background:#2868a8}figure{margin:1rem 0}figcaption{font-weight:600;margin-bottom:.5rem}nav a{margin-right:1rem}section[hidden]{display:none}@media(max-width:700px){body{padding:.8rem}.plot-row{grid-template-columns:1fr 2fr 4rem}}@media print{body{max-width:none;color:black;background:white}select{display:none}section[hidden]{display:block}.scroll{overflow:visible}table{font-size:8pt}details{break-inside:avoid}}
  </style></head><body><header><h1>Cross-engine benchmark campaign</h1><p class="banner${dataset.partial ? "" : " complete"}">${dataset.partial ? "PARTIAL — required measured evidence is missing or unqualified" : "COMPLETE — all planned arms have evidence"}</p>${provenance}<p>Plan: ${escapeHtml(dataset.planStatus)}. A ratio is right-arm completed-work time divided by left-arm time; above 1 means the left arm completed work faster. Every ratio is exploratory and tied to its named optimization class and protocol.</p><div class="counts">${summary.map((key) => `<span>${key === "notRun" ? "not-run" : key}: <strong>${coverage[key]}</strong></span>`).join("")}</div><nav aria-label="Experiment families">${families.map((family) => `<a href="#${escapeHtml(family)}">${escapeHtml(family)}</a>`).join("")}</nav><p><label for="family-filter">Show family:</label> <select id="family-filter"><option value="">All families</option>${families.map((family) => `<option value="${escapeHtml(family)}">${escapeHtml(family)}</option>`).join("")}</select></p></header><main>${families.map((family, index) => renderFamily(dataset, family, index)).join("")}</main><script>document.getElementById('family-filter').addEventListener('change',function(){for(const section of document.querySelectorAll('main section[data-family]'))section.hidden=this.value!==''&&section.dataset.family!==this.value;});function openEvidence(){const target=document.getElementById(location.hash.slice(1));if(target instanceof HTMLDetailsElement)target.open=true;}addEventListener('hashchange',openEvidence);openEvidence();</script></body></html>\n`;
  return { html, csv: renderCsv(dataset), json: `${JSON.stringify(dataset, null, 2)}\n` };
}
