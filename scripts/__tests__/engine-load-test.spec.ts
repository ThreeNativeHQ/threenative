import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type IModuleGraphEntry,
  extractModuleSpecifiers,
  hashServedModuleGraph,
  hashWorkloadModuleGraph,
  isBenchmarkWorkloadModule,
} from "../../examples/engine-load-test/src/identity.js";
import {
  createLcg,
  createPlacements,
  positionHash,
} from "../../examples/engine-load-test/src/workload.js";
import {
  type IRunReport,
  PERFORMANCE_BASELINES,
  PERFORMANCE_REGRESSION_TOLERANCE,
  checkEquivalence,
  checkPerformance,
  compare,
  knee,
  looksVsyncPinned,
  parseRunReport,
  summarize,
} from "../engine-load-test/report.js";
import { MINIMUM_BATTERY_PERCENT } from "../engine-load-test/run-android.js";
import { runCapturing } from "../engine-load-test/run-desktop.js";

const BEGIN_MARKER = "ENGINE_LOAD_TEST_JSON_BEGIN";
const END_MARKER = "ENGINE_LOAD_TEST_JSON_END";

function series(valueMs: number, length = 8): number[] {
  return Array.from({ length }, () => valueMs);
}

function rung(overrides: Partial<IRunReport["rungs"][number]> = {}): IRunReport["rungs"][number] {
  return {
    drawCalls: 4097,
    frameMs: series(10),
    mode: "L1",
    objectCount: 4096,
    positionHash: "aabbccdd",
    repeat: 0,
    triangles: 49_176,
    visibleObjects: 4096,
    ...overrides,
  };
}

function report(overrides: Partial<IRunReport> = {}): IRunReport {
  return {
    arm: "tn-web",
    build: { notes: "", type: "release" },
    device: { battery: null, label: "desktop-chrome-linux" },
    display: { height: 720, refreshHz: 60, vsync: false, width: 1280 },
    driver: { adapter: "test adapter", renderer: "test renderer" },
    engine: { name: "threenative", version: "workspace" },
    rungs: [rung()],
    ...overrides,
  };
}

// The ladder the knee tests read: three rungs under the 20 ms line, one over it.
function ladderReport(topP95: number, arm: IRunReport["arm"] = "tn-web"): IRunReport {
  return report({
    arm,
    engine: arm.startsWith("godot")
      ? { name: "godot", version: "4.7.1" }
      : { name: "threenative", version: "workspace" },
    rungs: [
      rung({
        drawCalls: 257,
        objectCount: 256,
        positionHash: "1111",
        triangles: 3074,
        visibleObjects: 256,
        frameMs: series(6),
      }),
      rung({
        drawCalls: 1025,
        objectCount: 1024,
        positionHash: "2222",
        triangles: 12_290,
        visibleObjects: 1024,
        frameMs: series(9),
      }),
      rung({
        drawCalls: 4097,
        objectCount: 4096,
        positionHash: "3333",
        triangles: 49_154,
        visibleObjects: 4096,
        frameMs: series(19),
      }),
      rung({
        drawCalls: 16_385,
        objectCount: 16_384,
        positionHash: "4444",
        triangles: 196_610,
        visibleObjects: 16_384,
        frameMs: series(topP95),
      }),
    ],
  });
}

describe("engine load test workload", () => {
  it("extracts executable module specifiers without reading strings or comments as imports", () => {
    const source = `
      const text = 'import "./fake-string.js"';
      // export { fake } from "./fake-comment.js";
      import /* comment */ "./side-effect.js";
      export { value } from /* comment */ "./named.js";
      const dynamic = import /* comment */ ("./dynamic.js");
      const asset = new URL("./asset.bin", import.meta.url);
      void text;
      void dynamic;
      void asset;
    `;
    expect(extractModuleSpecifiers(source)).toEqual([
      "./side-effect.js",
      "./named.js",
      "./dynamic.js",
      "./asset.bin",
    ]);
  });

  it("keeps engine implementation modules out of benchmark workload identity", async () => {
    const module = (url: string, source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url,
    });
    const game = module("http://127.0.0.1:5199/src/game.ts", 'import "./workload.ts";');
    const workload = module("http://127.0.0.1:5199/src/workload.ts", "export const count = 1;");
    const engine = module(
      "http://127.0.0.1:5199/@fs/home/repo/packages/core/src/renderProjection.ts",
      "export const implementation = 1;",
    );
    const changedEngine = module(engine.url, "export const implementation = 2;");
    const configuration = { frames: 1_800, ladder: [16_384], modes: ["L2", "L3"] };
    const workloadGraph = [game, workload, engine].filter(isBenchmarkWorkloadModule);
    const changedWorkloadGraph = [game, workload, changedEngine].filter(isBenchmarkWorkloadModule);
    expect(workloadGraph).toHaveLength(2);
    expect(await hashWorkloadModuleGraph(workloadGraph, configuration)).toBe(
      await hashWorkloadModuleGraph(changedWorkloadGraph, configuration),
    );
  });

  it("keeps executable template contents in the identity after optional catch binding", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/value.js",
    });
    for (const prefix of ["try {} catch {}\n", "debugger\n"]) {
      const baseline = `${prefix}/\`/.test("x"); globalThis.auditValue = \`//# sourceMappingURL=data:AAA\`;`;
      const candidate = baseline.replace("AAA", "BBB");

      expect(await hashServedModuleGraph([module(candidate)])).not.toBe(
        await hashServedModuleGraph([module(baseline)]),
      );
    }
  });

  it("keeps filtered workload identity stable across absolute engine import roots", async () => {
    const module = (url: string, source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url,
    });
    const graph = (worktree: string): IModuleGraphEntry[] => [
      module(
        "http://127.0.0.1:5199/src/game.ts",
        `import "/@fs${worktree}/packages/core/src/renderProjection.ts"; import "/src/workload.ts";`,
      ),
      module("http://127.0.0.1:5199/src/workload.ts", "export const count = 1;"),
      module(
        `http://127.0.0.1:5199/@fs${worktree}/packages/core/src/renderProjection.ts`,
        "export const projection = 1;",
      ),
    ];
    const configuration = { frames: 1_800, ladder: [16_384], modes: ["L2", "L3"] };
    const baseline = graph("/repo/.worktrees/baseline");
    const candidate = graph("/repo/.worktrees/candidate");

    expect(
      await hashWorkloadModuleGraph(
        baseline.filter(isBenchmarkWorkloadModule),
        configuration,
        baseline,
      ),
    ).toBe(
      await hashWorkloadModuleGraph(
        candidate.filter(isBenchmarkWorkloadModule),
        configuration,
        candidate,
      ),
    );
  });

  it("wires the browser collector to the syntax-aware scanner and workload filter", async () => {
    const browserSource = await readFile(
      path.join(process.cwd(), "examples/engine-load-test/src/main.ts"),
      "utf8",
    );
    expect(browserSource).toMatch(/extractModuleSpecifiers\(source\)/u);
    expect(browserSource).toMatch(/filter\(isBenchmarkWorkloadModule\)/u);
    expect(browserSource).toMatch(
      /hashWorkloadModuleGraph\([\s\S]*workloadModules[\s\S]*workloadGraph/u,
    );
    expect(browserSource).not.toMatch(/IMPORT_FROM_PATTERN|IMPORT_SIDE_EFFECT_PATTERN/u);
  });

  it("should produce the LCG sequence PRD-117 §3.3 specifies", () => {
    const random = createLcg();
    const first = random();
    expect(first).toBeCloseTo(((1337 * 1664525 + 1013904223) % 4294967296) / 4294967296, 12);
    expect(createLcg()()).toBe(first);
  });

  it("should place cubes identically on every call so both arms hash the same scene", () => {
    expect(positionHash(createPlacements(1024))).toBe(positionHash(createPlacements(1024)));
    expect(positionHash(createPlacements(1024))).not.toBe(positionHash(createPlacements(256)));
    expect(positionHash(createPlacements(1024))).toMatch(/^[0-9a-f]{8}$/);
  });

  it("should keep artifact identity independent of source labels and workload identity byte-sensitive", async () => {
    const module = (url: string, source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url,
    });
    const artifactModules = [
      module("/src/main.ts", "import './game.ts';"),
      module("/src/game.ts", "import './workload.ts';"),
      module("/src/workload.ts", "export const ladder = [256, 1024];"),
    ];
    const workloadConfiguration = {
      frames: 1_800,
      ladder: [16_384],
      modes: ["L2", "L3"],
      repeats: 1,
      warmup: 120,
    };
    const artifactHash = await hashServedModuleGraph(artifactModules);
    const relabeledArtifactHash = await hashServedModuleGraph(artifactModules);
    const workloadHash = await hashWorkloadModuleGraph(
      artifactModules.slice(1),
      workloadConfiguration,
    );
    const changedWorkloadHash = await hashWorkloadModuleGraph(
      [
        ...artifactModules.slice(1, 2),
        module("/src/workload.ts", "export const ladder = [256, 1024, 4096];"),
      ],
      workloadConfiguration,
    );
    const changedConfigurationHash = await hashWorkloadModuleGraph(artifactModules.slice(1), {
      ...workloadConfiguration,
      modes: ["L2"],
    });
    expect(relabeledArtifactHash).toBe(artifactHash);
    expect(changedWorkloadHash).not.toBe(workloadHash);
    expect(changedConfigurationHash).not.toBe(workloadHash);

    const candidateIdentity = { artifactHash, sourceSha: "candidate-sha", workloadHash };
    const relabeledIdentity = {
      artifactHash: relabeledArtifactHash,
      sourceSha: "other-sha",
      workloadHash,
    };
    expect(relabeledIdentity.artifactHash).toBe(candidateIdentity.artifactHash);
    expect(relabeledIdentity.sourceSha).not.toBe(candidateIdentity.sourceSha);

    const browserSource = await readFile(
      path.join(process.cwd(), "examples/engine-load-test/src/main.ts"),
      "utf8",
    );
    expect(browserSource).toMatch(/hashServedModuleGraph\(artifactModules\)/u);
    expect(browserSource).toMatch(
      /hashWorkloadModuleGraph\([\s\S]*workloadModules[\s\S]*workloadGraph/u,
    );
    expect(browserSource).not.toMatch(/hashServedModuleGraph\(sourceSha\)/u);
  });

  it("should keep graph identity stable across absolute worktree roots", async () => {
    const module = (url: string, source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url,
    });
    const graph = (worktree: string): IModuleGraphEntry[] => [
      module(
        `http://127.0.0.1:5199/@fs${worktree}/examples/engine-load-test/src/main.ts`,
        `import "/@fs${worktree}/packages/core/src/renderProjection.ts";`,
      ),
      module(
        `http://127.0.0.1:5199/@fs${worktree}/packages/core/src/renderProjection.ts`,
        'export const projection = "stable";',
      ),
    ];
    const baselineGraph = graph("/home/runner/work/threenative-baseline");
    const candidateGraph = graph("/home/runner/work/threenative-candidate");
    const configuration = {
      frames: 1_800,
      ladder: [16_384],
      modes: ["L2", "L3"],
      repeats: 1,
      warmup: 120,
    };

    const baselineArtifactHash = await hashServedModuleGraph(baselineGraph);
    const candidateArtifactHash = await hashServedModuleGraph(candidateGraph);
    const baselineWorkloadHash = await hashWorkloadModuleGraph(baselineGraph, configuration);
    const candidateWorkloadHash = await hashWorkloadModuleGraph(candidateGraph, configuration);
    const changedBytesHash = await hashWorkloadModuleGraph(
      candidateGraph.map((entry, index) =>
        index === 1
          ? module(entry.url, 'export const projection = "changed served bytes";')
          : entry,
      ),
      configuration,
    );
    const changedConfigurationHash = await hashWorkloadModuleGraph(candidateGraph, {
      ...configuration,
      modes: ["L2"],
    });

    expect(candidateArtifactHash).toBe(baselineArtifactHash);
    expect(candidateWorkloadHash).toBe(baselineWorkloadHash);
    expect(changedBytesHash).not.toBe(candidateWorkloadHash);
    expect(changedConfigurationHash).not.toBe(candidateWorkloadHash);
  });

  it("should keep graph identity stable across local Vite origins and entry order", async () => {
    const encode = (source: string): Uint8Array => new TextEncoder().encode(source);
    const graph: IModuleGraphEntry[] = [
      { url: "http://localhost:5199/src/a.js", bytes: encode("export const x=0;") },
      { url: "http://127.0.0.1:5199/src/b.js", bytes: encode("export const x=1;") },
    ];
    const reversed = [...graph].reverse();
    const configuration = { frames: 1_800, ladder: [16_384] };

    expect(await hashServedModuleGraph(graph)).toBe(await hashServedModuleGraph(reversed));
    expect(await hashWorkloadModuleGraph(graph, configuration)).toBe(
      await hashWorkloadModuleGraph(reversed, configuration),
    );
  });

  it("should keep graph identity stable for canonically distinct Unicode URLs and entry order", async () => {
    const encode = (source: string): Uint8Array => new TextEncoder().encode(source);
    const graph: IModuleGraphEntry[] = [
      { url: "/src/caf\u00e9.js", bytes: encode("export const value = 1;") },
      { url: "/src/cafe\u0301.js", bytes: encode("export const value = 1;") },
    ];
    const reversed = [...graph].reverse();
    const configuration = { frames: 1_800, ladder: [16_384] };

    expect(await hashServedModuleGraph(graph)).toBe(await hashServedModuleGraph(reversed));
    expect(await hashWorkloadModuleGraph(graph, configuration)).toBe(
      await hashWorkloadModuleGraph(reversed, configuration),
    );
  });

  it("should normalize local Vite loopback origins in graph URLs and module references", async () => {
    const encode = (source: string): Uint8Array => new TextEncoder().encode(source);
    const graph = (origin: string): IModuleGraphEntry[] => [
      {
        url: `${origin}/src/main.js`,
        bytes: encode(`import "${origin}/src/dependency.js";`),
      },
      { url: `${origin}/src/dependency.js`, bytes: encode("export const value = 1;") },
    ];
    const origins = [
      "http://127.0.0.1:5199",
      "http://127.0.0.1:5200",
      "http://localhost:5199",
      "http://localhost:5200",
      "http://[::1]:5199",
      "http://[::1]:5200",
    ];
    const configuration = { frames: 1_800, ladder: [16_384] };
    const baseline = graph(origins[0] ?? "");

    for (const origin of origins.slice(1)) {
      expect(await hashServedModuleGraph(graph(origin))).toBe(
        await hashServedModuleGraph(baseline),
      );
      expect(await hashWorkloadModuleGraph(graph(origin), configuration)).toBe(
        await hashWorkloadModuleGraph(baseline, configuration),
      );
    }
  });

  it("should reject conflicting duplicate module observations in either order", async () => {
    const duplicate: IModuleGraphEntry[] = [
      { url: "/src/duplicate.js", bytes: new TextEncoder().encode("export const x=0;") },
      { url: "/src/duplicate.js", bytes: new TextEncoder().encode("export const x=1;") },
    ];
    const configuration = { frames: 1_800 };

    for (const graph of [duplicate, [...duplicate].reverse()]) {
      await expect(hashServedModuleGraph(graph)).rejects.toThrow(
        /TN_BENCH_IDENTITY_ARTIFACT_UNAVAILABLE:conflicting duplicate module URL/u,
      );
      await expect(hashWorkloadModuleGraph(graph, configuration)).rejects.toThrow(
        /TN_BENCH_IDENTITY_ARTIFACT_UNAVAILABLE:conflicting duplicate module URL/u,
      );
    }
  });

  it("should strip large inline source maps without hiding executable byte changes", async () => {
    const encoder = new TextEncoder();
    const configuration = { frames: 1_800, modes: ["L2", "L3"], repeats: 1 };
    const executablePayload = "x".repeat(11_000_000);
    const graph = (worktree: string, changed = false): IModuleGraphEntry[] => {
      const executableSource = [
        `import "/@fs${worktree}/packages/core/src/index.ts";`,
        `export const payload = "${changed ? "y" : executablePayload}";`,
      ].join("\n");
      const sourceMap = {
        version: 3,
        sources: [`${worktree}/packages/core/src/index.ts`],
        sourcesContent: [`absolute checkout ${worktree}`],
        names: [],
        mappings: "AAAA",
      };
      return [
        {
          bytes: encoder.encode(
            `${executableSource}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(sourceMap)).toString("base64")}`,
          ),
          url: `http://127.0.0.1:5199/@fs${worktree}/examples/engine-load-test/src/main.ts`,
        },
      ];
    };
    const baseline = graph("/home/runner/work/threenative-baseline");
    const candidate = graph("/home/runner/work/threenative-candidate");

    const baselineArtifactHash = await hashServedModuleGraph(baseline);
    const candidateArtifactHash = await hashServedModuleGraph(candidate);
    const baselineWorkloadHash = await hashWorkloadModuleGraph(baseline, configuration);
    const candidateWorkloadHash = await hashWorkloadModuleGraph(candidate, configuration);
    const changedBytesHash = await hashWorkloadModuleGraph(
      graph("/home/runner/work/threenative-candidate", true),
      configuration,
    );

    expect(candidateArtifactHash).toBe(baselineArtifactHash);
    expect(candidateWorkloadHash).toBe(baselineWorkloadHash);
    expect(changedBytesHash).not.toBe(candidateWorkloadHash);
  });

  it("should strip only terminal inline source-map comments outside literals", async () => {
    const module = (source: string, url = "/src/main.ts"): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url,
    });
    const lineMarker = "//# sourceMappingURL=data:application/json;base64,ZmFrZQ==";
    const blockMarker = "/*# sourceMappingURL=data:application/json;base64,ZmFrZQ==*/";
    const templateSource = [
      "export const literal = `",
      lineMarker,
      "`;",
      "export const suffix = 1;",
    ].join("\n");
    const templateChanged = templateSource.replace("suffix = 1", "suffix = 2");
    expect(await hashServedModuleGraph([module(templateChanged)])).not.toBe(
      await hashServedModuleGraph([module(templateSource)]),
    );

    const stringSource = `export const literal = ${JSON.stringify(lineMarker)};\nexport const suffix = 1;`;
    expect(await hashServedModuleGraph([module(stringSource)])).not.toBe(
      await hashServedModuleGraph([module(stringSource.replace(lineMarker, "literal"))]),
    );

    const blockSource = ["export const before = 1;", blockMarker, "export const suffix = 1;"].join(
      "\n",
    );
    const blockChanged = blockSource.replace("suffix = 1", "suffix = 2");
    expect(await hashServedModuleGraph([module(blockChanged)])).not.toBe(
      await hashServedModuleGraph([module(blockSource)]),
    );

    const sourceMap = (root: string): string =>
      `/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify({ version: 3, sources: [`${root}/src/main.ts`], names: [], mappings: "" }),
      ).toString("base64")}*/`;
    const baseline = module(`export const stable = 1;\n${sourceMap("/home/baseline")}`);
    const candidate = module(`export const stable = 1;\n${sourceMap("/home/candidate")}`);
    expect(await hashServedModuleGraph([candidate])).toBe(await hashServedModuleGraph([baseline]));
  });

  it("should preserve executable bytes after line source maps separated by JS line terminators", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const lineMarker = "//# sourceMappingURL=data:application/json;base64,ZmFrZQ==";
    for (const separator of ["\u2028", "\u2029"]) {
      const baseline = module(
        `globalThis.auditValue=1;\n${lineMarker}${separator}globalThis.auditValue=1;`,
      );
      const candidate = module(
        `globalThis.auditValue=1;\n${lineMarker}${separator}globalThis.auditValue=2;`,
      );
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
    }
  });

  it("should strip a terminal inline source map after a regex literal", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const sourceMap = (root: string): string =>
      `/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify({ version: 3, sources: [`${root}/src/main.ts`], names: [], mappings: "" }),
      ).toString("base64")}*/`;
    const baseline = module(`export const regex = /"/g;\n${sourceMap("/home/baseline")}`);
    const candidate = module(`export const regex = /"/g;\n${sourceMap("/home/candidate")}`);
    expect(await hashServedModuleGraph([candidate])).toBe(await hashServedModuleGraph([baseline]));
  });

  it("should preserve executable template bytes after a control-condition regex", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );
  });

  it("should preserve executable bytes after break and continue statement completion", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const separators = ["\n", "\r", "\r\n", "\u2028", "\u2029", "/* multiline comment\n */"];
    const regexLiteral = "/`/;";
    const source = (
      keyword: "break" | "continue",
      labeled: boolean,
      separator: string,
      marker: string,
    ): string => {
      const statement = labeled ? `${keyword} loop` : keyword;
      return [
        "loop: for (;;) {",
        `  ${statement}${separator}${regexLiteral}`,
        "}",
        `globalThis.auditValue = \`//# sourceMappingURL=data:${marker}\`;`,
      ].join("\n");
    };

    for (const keyword of ["break", "continue"] as const) {
      for (const labeled of [false, true]) {
        for (const separator of separators) {
          const baseline = module(source(keyword, labeled, separator, "AAA"));
          const candidate = module(source(keyword, labeled, separator, "BBB"));
          expect(await hashServedModuleGraph([candidate])).not.toBe(
            await hashServedModuleGraph([baseline]),
          );
          expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
            await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
          );
        }
      }
    }
  });

  it("should consume escaped break and continue labels across every separator", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const separators = [
      "\n",
      "\r",
      "\r\n",
      "\u2028",
      "\u2029",
      "/* comment */",
      "/* multiline comment\n */",
      "// comment\n",
    ];
    const labels = [
      "",
      "loop",
      String.raw`\u006coop`,
      String.raw`\u{6c}oop`,
      String.raw`\u{000006c}oop`,
    ];
    const source = (
      keyword: "break" | "continue",
      label: string,
      separator: string,
      marker: string,
    ): string => {
      const statement = label.length === 0 ? keyword : `${keyword} ${label}`;
      return [
        "loop: for (;;) {",
        `  ${statement}${separator}/\`/;`,
        "}",
        `globalThis.auditValue = \`//# sourceMappingURL=data:${marker}\`;`,
      ].join("\n");
    };

    for (const keyword of ["break", "continue"] as const) {
      for (const label of labels) {
        for (const separator of separators) {
          const baseline = module(source(keyword, label, separator, "AAA"));
          const candidate = module(source(keyword, label, separator, "BBB"));
          expect(await hashServedModuleGraph([candidate])).not.toBe(
            await hashServedModuleGraph([baseline]),
          );
          expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
            await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
          );
        }
      }
    }
  });

  it("should ignore only the absolute root in a terminal map after a control-condition regex", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const sourceMap = (root: string): string =>
      `/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify({ version: 3, sources: [`${root}/src/main.ts`], names: [], mappings: "" }),
      ).toString("base64")}*/`;
    const baseline = module(`if (true) /"/g.test("x");\n${sourceMap("/home/baseline")}`);
    const candidate = module(`if (true) /"/g.test("x");\n${sourceMap("/home/candidate")}`);

    expect(await hashServedModuleGraph([candidate])).toBe(await hashServedModuleGraph([baseline]));
  });

  it("should preserve executable template bytes after nested control-condition regexes", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'if (true) if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'if (true) if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );
  });

  it("should preserve executable template bytes after keyword properties and contextual identifiers", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const testCases = [
      'globalThis.return / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const of = 1; of / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'function f() { return /`/.test("x"); } globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'for (const x of /`/.test("x")) {} globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of testCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should preserve control-parenthesis context through for await", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'for await (const x of []) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'for await (const x of []) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );
  });

  it("should preserve for-await context through trivia and all JavaScript line terminators", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const separators = [
      "\n",
      "/* comment */",
      "/* comment\n */",
      "// comment\n",
      "\u2028",
      "\u2029",
    ];
    const source = (separator: string, marker: string): string =>
      `for${separator}await (const x of []) /\`/.test("x"); globalThis.auditValue = \`//# sourceMappingURL=data:${marker}\`;`;

    for (const separator of separators) {
      const baseline = module(source(separator, "AAA"));
      const candidate = module(source(separator, "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should classify only the actual for-of separator and preserve an of identifier", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'for (let of = 0; of / 1;) {} if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'for (let of = 0; of / 1;) {} if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );
  });

  it("should preserve unary operand context before an of identifier", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'for (let x = typeof of / 1; false;) {} if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'for (let x = typeof of / 1; false;) {} if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );
  });

  it("should preserve prefix update operand context across trivia", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const source = (init: string, marker: string): string =>
      `let of=0; for(${init};false;){} /\`/; globalThis.auditValue=\`//# sourceMappingURL=data:${marker}\`;`;
    const separators = [
      "",
      "/* block comment */",
      "/* block comment\n */",
      "// line comment\n",
      "\n",
      "\r",
      "\r\n",
      "\u2028",
      "\u2029",
    ];

    for (const update of ["++", "--"]) {
      for (const separator of separators) {
        const baseline = module(source(`${update}${separator}of / 1`, "AAA"));
        const candidate = module(source(`${update}${separator}of / 1`, "BBB"));
        expect(await hashServedModuleGraph([candidate])).not.toBe(
          await hashServedModuleGraph([baseline]),
        );
        expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
          await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
        );
      }
    }

    for (const update of ["++", "--"]) {
      const baseline = module(source(`of${update} / 1`, "AAA"));
      const candidate = module(source(`of${update} / 1`, "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }

    const ordinaryForOf = (marker: string): IModuleGraphEntry =>
      module(
        `for (const value of []) {} /\`/; globalThis.auditValue=\`//# sourceMappingURL=data:${marker}\`;`,
      );
    const ordinaryBaseline = ordinaryForOf("AAA");
    const ordinaryCandidate = ordinaryForOf("BBB");
    expect(await hashServedModuleGraph([ordinaryCandidate])).not.toBe(
      await hashServedModuleGraph([ordinaryBaseline]),
    );
    expect(await hashWorkloadModuleGraph([ordinaryCandidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([ordinaryBaseline], { frames: 1_800 }),
    );
  });

  it("should establish restricted-production ASI boundaries only after line breaks", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const lineBreakCases = [
      'function f() { return\nfunction g() {} /`/.test("x"); } globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'function* f() { yield\nfunction g() {} /`/.test("x"); } globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of lineBreakCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }

    const sameLineBaseline = module(
      "function f() { return function g() {} / 1; } globalThis.auditValue = `//# sourceMappingURL=data:AAA`;",
    );
    const sameLineCandidate = module(
      "function f() { return function g() {} / 1; } globalThis.auditValue = `//# sourceMappingURL=data:BBB`;",
    );
    expect(await hashServedModuleGraph([sameLineCandidate])).not.toBe(
      await hashServedModuleGraph([sameLineBaseline]),
    );
    expect(await hashWorkloadModuleGraph([sameLineCandidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([sameLineBaseline], { frames: 1_800 }),
    );
  });

  it("should establish yield ASI boundaries when yield occurs inside an expression", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'function* f() {\n  const x = yield\n  function g() {} /`/.test("x");\n}\nglobalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'function* f() {\n  const x = yield\n  function g() {} /`/.test("x");\n}\nglobalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );

    const sameLineBaseline = module(
      "function* f() { const x = yield function g() {} / 1; } globalThis.auditValue = `//# sourceMappingURL=data:AAA`;",
    );
    const sameLineCandidate = module(
      "function* f() { const x = yield function g() {} / 1; } globalThis.auditValue = `//# sourceMappingURL=data:BBB`;",
    );
    expect(await hashServedModuleGraph([sameLineCandidate])).not.toBe(
      await hashServedModuleGraph([sameLineBaseline]),
    );
    expect(await hashWorkloadModuleGraph([sameLineCandidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([sameLineBaseline], { frames: 1_800 }),
    );
  });

  it("should ignore only the absolute root in a terminal map after nested control-condition regexes", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const sourceMap = (root: string): string =>
      `/*# sourceMappingURL=data:application/json;base64,${Buffer.from(
        JSON.stringify({ version: 3, sources: [`${root}/src/main.ts`], names: [], mappings: "" }),
      ).toString("base64")}*/`;
    const baseline = module(`if (true) if (true) /"/g.test("x");\n${sourceMap("/home/baseline")}`);
    const candidate = module(
      `if (true) if (true) /"/g.test("x");\n${sourceMap("/home/candidate")}`,
    );

    expect(await hashServedModuleGraph([candidate])).toBe(await hashServedModuleGraph([baseline]));
  });

  it("should preserve executable template bytes after a labeled statement boundary", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'audit: if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'audit: if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
  });

  it("should preserve executable template bytes after a switch case boundary", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'switch (true) { case true: if (true) /`/.test("x"); } globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'switch (true) { case true: if (true) /`/.test("x"); } globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
  });

  it("should preserve division after a function expression and later executable template bytes", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const baseline = module(
      'const f = function() {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'const f = function() {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );
  });

  it("should preserve statement boundary after async function and generator declarations", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const testCases = [
      'async function f() {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'async function* g() {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const x = 1\nasync function f() {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const x = 1\nasync function* g() {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const x = 1\n/* separator\n */ async function f() {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const x = 1\nif (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of testCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should preserve expression context for async function expressions and line-terminated async identifiers", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const exprCases = [
      'const f = async function() {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const f = async\nfunction f2() {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of exprCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should distinguish conditional expression colons from statement boundaries", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const conditionalCases = [
      'const f = true ? 0 : function() {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const f = a ? b ? 1 : 2 : function() {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const obj = { a: true ? 0 : function() {} / 1 }; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of conditionalCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should distinguish class expressions from class declarations", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const classCases = [
      'const F = class {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const F = class Named {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const arr = [class {} / 1]; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'class C {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of classCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should preserve class-field initializer expressions and module references", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.js",
    });
    const baseline = module(
      'class C { x = function() {} / 1; } /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    );
    const candidate = module(
      'class C { x = function() {} / 1; } /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:BBB`;',
    );

    expect(await hashServedModuleGraph([candidate])).not.toBe(
      await hashServedModuleGraph([baseline]),
    );
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );

    const baselinePath = "/@fs/repo/packages/core/src/a";
    const candidatePath = "packages/core/src/a";
    const moduleReferences: [string, string][] = [
      [
        `class C { x = import(${JSON.stringify(baselinePath)}); }`,
        `class C { x = import(${JSON.stringify(candidatePath)}); }`,
      ],
      [
        `class C { x = new URL(${JSON.stringify(baselinePath)}, import.meta.url); }`,
        `class C { x = new URL(${JSON.stringify(candidatePath)}, import.meta.url); }`,
      ],
    ];
    for (const [baselineSource, candidateSource] of moduleReferences) {
      expect(await hashServedModuleGraph([module(candidateSource)])).toBe(
        await hashServedModuleGraph([module(baselineSource)]),
      );
      expect(await hashWorkloadModuleGraph([module(candidateSource)], { frames: 1_800 })).toBe(
        await hashWorkloadModuleGraph([module(baselineSource)], { frames: 1_800 }),
      );
    }
  });

  it("should not treat property or private names as keyword syntax", async () => {
    const module = (source: string, url = "/src/main.ts"): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url,
    });
    const propertyCases = [
      'class C extends ({ class: Object }).class {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'class C extends globalThis.function() {} /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of propertyCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }

    const checkoutUrl = "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.ts";
    const privateNameCases = (pathValue: string): string[] => [
      `class C { #import(x) { return x; } run() { return this.#import(${JSON.stringify(pathValue)}); } }`,
      `class C { #new(x) { return x; } run() { return this.#new\nURL(${JSON.stringify(pathValue)}, import.meta.url); } }`,
    ];
    const baselinePath = "/@fs/repo/packages/core/src/a";
    const candidatePath = "packages/core/src/a";
    for (const index of [0, 1]) {
      const baseline = module(privateNameCases(baselinePath)[index] ?? "", checkoutUrl);
      const candidate = module(privateNameCases(candidatePath)[index] ?? "", checkoutUrl);
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should preserve statement boundaries after declarations separated by ASI", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const testCases = [
      'const x = 1\nfunction f() {} /`/.test("x");\nglobalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const x = 1\nclass C {} /`/.test("x");\nglobalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const café = 1\u2028function f() {} /`/.test("x");\nglobalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const café = 1\u2029class C {} /`/.test("x");\nglobalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of testCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should preserve class-expression context through heritage parentheses", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const testCases = [
      'const C = class extends (Object) {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const C = class extends (class {}) {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const C = class extends ((class {})) {} / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'const C = Object.assign(class {}, {}) / 1; if (true) /`/.test("x"); globalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of testCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));

      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should consume nullish operators without recording conditional questions", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "/src/main.ts",
    });
    const testCases = [
      'const x = null ?? 1;\nlabel: if (true) /`/.test("x");\nglobalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
      'let x;\nx ??= 1;\nlabel: if (true) /`/.test("x");\nglobalThis.auditValue = `//# sourceMappingURL=data:AAA`;',
    ];
    for (const statement of testCases) {
      const baseline = module(statement);
      const candidate = module(statement.replace("AAA", "BBB"));
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should canonicalize only syntactic module references", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/a.js",
    });
    const runtimeCases: [string, string][] = [
      [
        'globalThis.auditValue = `"/@fs/repo/packages/core/src/a"`;',
        'globalThis.auditValue = `"packages/core/src/a"`;',
      ],
      [
        'globalThis.auditValue = "/@fs/repo/packages/core/src/a";',
        'globalThis.auditValue = "packages/core/src/a";',
      ],
      [
        'globalThis.auditValue = new RegExp("\\"/@fs/repo/packages/core/src/a\\"").source;',
        'globalThis.auditValue = new RegExp("\\"packages/core/src/a\\"").source;',
      ],
      [
        'globalThis.import\n"/@fs/repo/packages/core/src/a";',
        'globalThis.import\n"packages/core/src/a";',
      ],
      [
        'const obj = { from: 0 };\nexport default obj.from\n"/@fs/repo/packages/core/src/a";',
        'const obj = { from: 0 };\nexport default obj.from\n"packages/core/src/a";',
      ],
    ];
    for (const [baselineSource, candidateSource] of runtimeCases) {
      const baseline = module(baselineSource);
      const candidate = module(candidateSource);
      expect(await hashServedModuleGraph([candidate])).not.toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }

    const moduleReferenceCases: [string, string][] = [
      ['import "/@fs/repo/packages/core/src/a";', 'import "packages/core/src/a";'],
      [
        'export { value } from "/@fs/repo/packages/core/src/a";',
        'export { value } from "packages/core/src/a";',
      ],
      ['void import("/@fs/repo/packages/core/src/a");', 'void import("packages/core/src/a");'],
      [
        'new URL("/@fs/repo/packages/core/src/a", import.meta.url);',
        'new URL("packages/core/src/a", import.meta.url);',
      ],
      [
        'globalThis.auditValue = `${import("/@fs/repo/packages/core/src/a")}`;',
        'globalThis.auditValue = `${import("packages/core/src/a")}`;',
      ],
    ];
    for (const [baselineSource, candidateSource] of moduleReferenceCases) {
      const baseline = module(baselineSource);
      const candidate = module(candidateSource);
      expect(await hashServedModuleGraph([candidate])).toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }

    const lookalikeBaseline =
      'globalThis.new\nURL("/@fs/repo/packages/core/src/a", import.meta.url);';
    const lookalikeCandidate = 'globalThis.new\nURL("packages/core/src/a", import.meta.url);';
    const runtimeSpecifier = (source: string): string => {
      const match = /URL\("([^"]+)", import\.meta\.url\)/u.exec(source);
      if (match?.[1] === undefined) throw new Error("test fixture has no URL argument");
      return match[1];
    };
    expect(runtimeSpecifier(lookalikeBaseline)).toBe("/@fs/repo/packages/core/src/a");
    expect(runtimeSpecifier(lookalikeCandidate)).toBe("packages/core/src/a");
    expect(runtimeSpecifier(lookalikeBaseline)).not.toBe(runtimeSpecifier(lookalikeCandidate));
    expect(lookalikeBaseline).not.toBe(lookalikeCandidate);
    expect(await hashServedModuleGraph([module(lookalikeCandidate)])).not.toBe(
      await hashServedModuleGraph([module(lookalikeBaseline)]),
    );
    expect(await hashWorkloadModuleGraph([module(lookalikeCandidate)], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([module(lookalikeBaseline)], { frames: 1_800 }),
    );
  });

  it("should recognize new URL module references with a trailing comma and trivia", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.js",
    });
    const urlSource = (pathValue: string): string =>
      `new URL(${JSON.stringify(pathValue)}, import.meta.url, /* trailing */\n\t)`;
    const baselinePath = "/@fs/repo/packages/core/src/a";
    const candidatePath = "packages/core/src/a";
    const baseline = module(urlSource(baselinePath));
    const candidate = module(urlSource(candidatePath));

    expect(await hashServedModuleGraph([candidate])).toBe(await hashServedModuleGraph([baseline]));
    expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).toBe(
      await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
    );

    const differingValues: [string, string][] = [
      ["/@fs/repo/packages/core/src/a?one", "/@fs/repo/packages/core/src/a?two"],
      ["/@fs/repo/packages/core/src/a#one", "/@fs/repo/packages/core/src/a#two"],
      ["data:text/plain,AAA", "data:text/plain,BBB"],
    ];
    for (const [baselineValue, candidateValue] of differingValues) {
      const queryBaseline = module(urlSource(baselineValue));
      const queryCandidate = module(urlSource(candidateValue));
      expect(await hashServedModuleGraph([queryCandidate])).not.toBe(
        await hashServedModuleGraph([queryBaseline]),
      );
      expect(await hashWorkloadModuleGraph([queryCandidate], { frames: 1_800 })).not.toBe(
        await hashWorkloadModuleGraph([queryBaseline], { frames: 1_800 }),
      );
    }

    const lookalikeBaseline = module(
      `globalThis.new\nURL(${JSON.stringify(baselinePath)}, import.meta.url, /* trailing */\n\t)`,
    );
    const lookalikeCandidate = module(
      `globalThis.new\nURL(${JSON.stringify(candidatePath)}, import.meta.url, /* trailing */\n\t)`,
    );
    expect(await hashServedModuleGraph([lookalikeCandidate])).not.toBe(
      await hashServedModuleGraph([lookalikeBaseline]),
    );
    expect(await hashWorkloadModuleGraph([lookalikeCandidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([lookalikeBaseline], { frames: 1_800 }),
    );
  });

  it("should canonicalize multiline static imports through named clauses and comments", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.js",
    });
    const cases: [string, string][] = [
      ['import x\nfrom "/@fs/repo/packages/core/src/a";', 'import x\nfrom "packages/core/src/a";'],
      [
        'import { x as y, z } // keep the import open\nfrom "/@fs/repo/packages/core/src/a";',
        'import { x as y, z } // keep the import open\nfrom "packages/core/src/a";',
      ],
    ];
    for (const [baselineSource, candidateSource] of cases) {
      const baseline = module(baselineSource);
      const candidate = module(candidateSource);
      expect(await hashServedModuleGraph([candidate])).toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should canonicalize multiline named import and export clauses", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.js",
    });
    const separators = [
      "\n",
      "\r",
      "\r\n",
      "\u2028",
      "\u2029",
      "/* block comment */\n",
      "/* block comment\n */",
      "// line comment\n",
    ];
    const baselinePath = "/@fs/repo/packages/core/src/a";
    const candidatePath = "packages/core/src/a";
    for (const statement of ["export ", "import "]) {
      for (const separator of separators) {
        const source = (pathValue: string): string =>
          `${statement}{${separator}x} from ${JSON.stringify(pathValue)};`;
        const baseline = module(source(baselinePath));
        const candidate = module(source(candidatePath));
        expect(await hashServedModuleGraph([candidate])).toBe(
          await hashServedModuleGraph([baseline]),
        );
        expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).toBe(
          await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
        );
      }
    }
  });

  it("should preserve legal multiline static import and export continuations", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.js",
    });
    const cases: [string, string][] = [
      [
        'import x\n, { y } from "/@fs/repo/packages/core/src/a";',
        'import x\n, { y } from "packages/core/src/a";',
      ],
      ['export\n* from "/@fs/repo/packages/core/src/a";', 'export\n* from "packages/core/src/a";'],
      [
        'export\n{ x } from "/@fs/repo/packages/core/src/a";',
        'export\n{ x } from "packages/core/src/a";',
      ],
    ];
    for (const [baselineSource, candidateSource] of cases) {
      const baseline = module(baselineSource);
      const candidate = module(candidateSource);
      expect(await hashServedModuleGraph([candidate])).toBe(
        await hashServedModuleGraph([baseline]),
      );
      expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).toBe(
        await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
      );
    }
  });

  it("should preserve namespace static import and export continuations through binding names", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.js",
    });
    const separators = [
      "\n",
      "/* comment */\n",
      "/* comment\n */",
      "// comment\n",
      "\u2028",
      "\u2029",
    ];
    const baselinePath = "/@fs/repo/packages/core/src/a";
    const candidatePath = "packages/core/src/a";
    for (const statement of ["import * as", "export * as"]) {
      for (const separator of separators) {
        const source = (pathValue: string): string =>
          `${statement}${separator}x from ${JSON.stringify(pathValue)};`;
        const baseline = module(source(baselinePath));
        const candidate = module(source(candidatePath));
        expect(await hashServedModuleGraph([candidate])).toBe(
          await hashServedModuleGraph([baseline]),
        );
        expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).toBe(
          await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
        );
      }
    }
  });

  it("should canonicalize named clauses across every trivia boundary", async () => {
    const module = (source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url: "http://127.0.0.1:5199/@fs/repo/packages/core/src/main.js",
    });
    const separators = [
      "\n",
      "\r",
      "\r\n",
      "\u2028",
      "\u2029",
      "/* block comment */",
      "/* multiline comment\n */",
      "// line comment\n",
    ];
    const baselinePath = "/@fs/repo/packages/core/src/a";
    const candidatePath = "packages/core/src/a";
    const clauseSources = [
      (statement: string, separator: string, pathValue: string): string =>
        `${statement}{${separator}x} from ${JSON.stringify(pathValue)};`,
      (statement: string, separator: string, pathValue: string): string =>
        `${statement}{x${separator}as y} from ${JSON.stringify(pathValue)};`,
      (statement: string, separator: string, pathValue: string): string =>
        `${statement}{x${separator}} from ${JSON.stringify(pathValue)};`,
      (statement: string, separator: string, pathValue: string): string =>
        `${statement}{x as y${separator}} from ${JSON.stringify(pathValue)};`,
    ];

    for (const statement of ["export ", "import "]) {
      for (const separator of separators) {
        for (const createSource of clauseSources) {
          const baseline = module(createSource(statement, separator, baselinePath));
          const candidate = module(createSource(statement, separator, candidatePath));
          expect(await hashServedModuleGraph([candidate])).toBe(
            await hashServedModuleGraph([baseline]),
          );
          expect(await hashWorkloadModuleGraph([candidate], { frames: 1_800 })).toBe(
            await hashWorkloadModuleGraph([baseline], { frames: 1_800 }),
          );
        }
      }
    }

    const propertyBaseline = module(
      `const object = { x: 1 };\nexport {x} from ${JSON.stringify(candidatePath)};`,
    );
    const propertyCandidate = module(
      `const object = { y: 1 };\nexport {x} from ${JSON.stringify(candidatePath)};`,
    );
    expect(await hashServedModuleGraph([propertyCandidate])).not.toBe(
      await hashServedModuleGraph([propertyBaseline]),
    );
    expect(await hashWorkloadModuleGraph([propertyCandidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([propertyBaseline], { frames: 1_800 }),
    );

    const statementBaseline = module(
      `const unrelated = 1;\nexport {x} from ${JSON.stringify(candidatePath)};`,
    );
    const statementCandidate = module(
      `const unrelated = 2;\nexport {x} from ${JSON.stringify(candidatePath)};`,
    );
    expect(await hashServedModuleGraph([statementCandidate])).not.toBe(
      await hashServedModuleGraph([statementBaseline]),
    );
    expect(await hashWorkloadModuleGraph([statementCandidate], { frames: 1_800 })).not.toBe(
      await hashWorkloadModuleGraph([statementBaseline], { frames: 1_800 }),
    );
  });

  it("should preserve full paths when recognized Vite layouts repeat", async () => {
    const module = (url: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode("export const shared = true;"),
      url,
    });
    const rooted = (root: string): IModuleGraphEntry[] => [
      module(`http://127.0.0.1:5199/@fs${root}/packages/core/src/a/packages/core/src/index.ts`),
    ];
    expect(await hashServedModuleGraph(rooted("/repo-a"))).not.toBe(
      await hashServedModuleGraph(rooted("/repo-b")),
    );
  });

  it("should preserve full paths when adjacent Vite layout evidence overlaps", async () => {
    const module = (url: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode("export const shared = true;"),
      url,
    });
    const rooted = (root: string): IModuleGraphEntry[] => [
      module(`http://127.0.0.1:5199/@fs${root}/packages/core/src/packages/core/src/index.ts`),
    ];

    expect(await hashServedModuleGraph(rooted("/repo-a"))).not.toBe(
      await hashServedModuleGraph(rooted("/repo-b")),
    );
  });

  it("should preserve complete package paths in served module identity", async () => {
    const module = (url: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode("export const shared = true;"),
      url,
    });
    const graph = (path: string): IModuleGraphEntry[] => [
      module(`http://127.0.0.1:5199/@fs/repo/${path}`),
    ];
    const core = await hashServedModuleGraph(graph("packages/core/src/index.ts"));
    const physics = await hashServedModuleGraph(graph("packages/physics/src/index.ts"));
    const nestedA = await hashServedModuleGraph(
      graph("node_modules/outer/node_modules/packages/src/index.ts"),
    );
    const nestedB = await hashServedModuleGraph(
      graph("node_modules/other/node_modules/packages/src/index.ts"),
    );

    expect(physics).not.toBe(core);
    expect(nestedB).not.toBe(nestedA);

    const rooted = (root: string): IModuleGraphEntry[] => [
      module(`http://127.0.0.1:5199/@fs${root}/packages/core/src/index.ts`),
    ];
    expect(await hashServedModuleGraph(rooted("/home/packages/candidate"))).toBe(
      await hashServedModuleGraph(rooted("/home/packages/baseline")),
    );
  });

  it("should preserve ordinary external URLs and module query identity", async () => {
    const module = (url: string, source: string): IModuleGraphEntry => ({
      bytes: new TextEncoder().encode(source),
      url,
    });
    const externalUrl = (value: string): IModuleGraphEntry[] => [
      module("/src/workload.ts", `export const mesh = ${JSON.stringify(value)};`),
    ];
    const rawModule = [module("/src/shader.glsl?raw", 'export default "shader";')];
    const urlModule = [module("/src/shader.glsl?url", 'export default "shader";')];
    const localVite = (origin: string): IModuleGraphEntry[] => [
      module(`${origin}/src/workload.ts?raw#stable`, 'export const mesh = "stable";'),
    ];
    const dataUrl = (value: string): IModuleGraphEntry[] => [
      module("/src/data.ts", `export const asset = ${JSON.stringify(value)};`),
    ];
    const unrecognizedPath = (value: string): IModuleGraphEntry[] => [
      module("/src/path.ts", `export const path = ${JSON.stringify(value)};`),
    ];
    const externalAbsolute = (origin: string): IModuleGraphEntry[] => [
      module(`${origin}/@fs/repo/packages/core/src/index.ts`, "export const shared = true;"),
    ];

    expect(
      await hashWorkloadModuleGraph(externalUrl("https://a.example/mesh?quality=low"), {}),
    ).not.toBe(
      await hashWorkloadModuleGraph(externalUrl("https://b.example/mesh?quality=high"), {}),
    );
    expect(await hashServedModuleGraph(rawModule)).not.toBe(await hashServedModuleGraph(urlModule));
    expect(await hashWorkloadModuleGraph(rawModule, {})).not.toBe(
      await hashWorkloadModuleGraph(urlModule, {}),
    );
    expect(await hashServedModuleGraph(localVite("http://127.0.0.1:5199"))).toBe(
      await hashServedModuleGraph(localVite("http://127.0.0.1:5200")),
    );
    expect(await hashWorkloadModuleGraph(dataUrl("data:text/plain;base64,AAAA"), {})).not.toBe(
      await hashWorkloadModuleGraph(dataUrl("data:text/plain;base64,BBBB"), {}),
    );
    expect(await hashWorkloadModuleGraph(unrecognizedPath("/not-a-vite-module?raw"), {})).not.toBe(
      await hashWorkloadModuleGraph(unrecognizedPath("/not-a-vite-module?url"), {}),
    );
    expect(await hashServedModuleGraph(externalAbsolute("https://a.example"))).not.toBe(
      await hashServedModuleGraph(externalAbsolute("https://b.example")),
    );
  });

  it("should fail closed when a served module observation has no URL", async () => {
    const bytes = new TextEncoder().encode("export const value = 1;");
    await expect(hashServedModuleGraph([])).rejects.toThrow(
      /TN_BENCH_IDENTITY_ARTIFACT_UNAVAILABLE:empty graph/u,
    );

    const missingUrlEntries: readonly (readonly IModuleGraphEntry[])[] = [
      [{ bytes, url: "" }],
      [{ bytes } as unknown as IModuleGraphEntry],
      [{ bytes, url: undefined } as unknown as IModuleGraphEntry],
    ];
    for (const entries of missingUrlEntries) {
      await expect(hashServedModuleGraph(entries)).rejects.toThrow(
        /TN_BENCH_IDENTITY_ARTIFACT_UNAVAILABLE:missing module URL/u,
      );
    }

    const validHash = await hashServedModuleGraph([{ bytes, url: "/src/main.ts" }]);
    expect(validHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});

describe("engine load test scorer", () => {
  it("should reject a rung with an empty frame series", () => {
    expect(() => parseRunReport(report({ rungs: [rung({ frameMs: [] })] }))).toThrow(
      /TN_BENCH_EMPTY_SERIES/,
    );
  });

  it("should reject a report missing its driver line", () => {
    const missing = report() as unknown as Record<string, unknown>;
    // biome-ignore lint/performance/noDelete: the point of the test is an absent key.
    delete missing.driver;
    expect(() => parseRunReport(missing)).toThrow(/TN_BENCH_MISSING_DRIVER/);
    expect(() => parseRunReport(report({ driver: { adapter: "", renderer: "gl" } }))).toThrow(
      /TN_BENCH_MISSING_DRIVER/,
    );
  });

  it("should reject a report with no rungs at all", () => {
    expect(() => parseRunReport(report({ rungs: [] }))).toThrow(/TN_BENCH_NO_RUNGS/);
  });

  it("should require a condition block on Android reports", () => {
    expect(() => parseRunReport(report({ arm: "tn-android" }))).toThrow(
      /TN_BENCH_BAD_SHAPE|TN_BENCH_MISSING_DEVICE_CONDITION/,
    );
    const parsed = parseRunReport(
      report({
        arm: "tn-android",
        deviceCondition: {
          batteryPercent: 80,
          charging: false,
          chargingSource: "NONE",
          provisional: [],
          screenOn: true,
          serial: "37251FDJH0037Z",
          thermalStatus: "NONE",
          thermalStatusCode: 0,
        },
        provisional: [],
      }),
    );
    expect(parsed.deviceCondition?.thermalStatus).toBe("NONE");
  });

  it("should require matching nested and top-level provisional arrays", () => {
    const android = report({
      arm: "tn-android",
      deviceCondition: {
        batteryPercent: 80,
        charging: false,
        chargingSource: "NONE",
        provisional: [],
        screenOn: true,
        serial: "37251FDJH0037Z",
        thermalStatus: "NONE",
        thermalStatusCode: 0,
      },
      provisional: [],
    });
    expect(parseRunReport(android).deviceCondition?.provisional).toEqual([]);

    expect(() => parseRunReport({ ...android, provisional: undefined })).toThrow(
      /TN_BENCH_BAD_SHAPE|TN_BENCH_MISSING_DEVICE_CONDITION/,
    );
    expect(() =>
      parseRunReport({
        ...android,
        deviceCondition: { ...android.deviceCondition, provisional: undefined },
      }),
    ).toThrow(/TN_BENCH_BAD_SHAPE|TN_BENCH_MISSING_DEVICE_CONDITION/);
    expect(() =>
      parseRunReport({
        ...android,
        provisional: [""],
        deviceCondition: { ...android.deviceCondition, provisional: [""] },
      }),
    ).toThrow(/TN_BENCH_BAD_SHAPE/);
    expect(() =>
      parseRunReport({
        ...android,
        provisional: [],
        deviceCondition: { ...android.deviceCondition, provisional: ["battery"] },
      }),
    ).toThrow(/TN_BENCH_BAD_SHAPE/);
  });

  it("should compute the knee as the largest rung at or below 20 ms p95", () => {
    expect(knee(summarize(ladderReport(24)), "L1")).toBe(4096);
    // Shift the top of the fixture under the line and the knee climbs a rung; shift the rung
    // below it over the line and the knee drops one.
    expect(knee(summarize(ladderReport(19)), "L1")).toBe(16_384);
    const dropped = ladderReport(24);
    dropped.rungs[2] = rung({ ...dropped.rungs[2], frameMs: series(21) });
    expect(knee(summarize(dropped), "L1")).toBe(1024);
  });

  it("should report no knee when even the first rung crosses the line", () => {
    const slow = ladderReport(99);
    slow.rungs = slow.rungs.map((entry) => ({ ...entry, frameMs: series(40) }));
    expect(knee(summarize(slow), "L1")).toBeNull();
  });
});

describe("engine load test equivalence gate", () => {
  it("should refuse a comparison whose scenes hash differently, naming the field", () => {
    const left = ladderReport(24);
    const right = ladderReport(24, "godot-web");
    right.rungs[1] = rung({ ...right.rungs[1], positionHash: "deadbeef" });
    expect(checkEquivalence(left, right).map((failure) => failure.field)).toContain("positionHash");
    expect(() => compare(left, right)).toThrow(/TN_BENCH_NOT_EQUIVALENT.*positionHash/s);
  });

  it("should refuse a hash that diverges on only one repeat of a rung", () => {
    // The first cut of the gate keyed one rung per ladder step, so every repeat but the last was
    // invisible and a single diverged scene published as if it matched.
    const left = ladderReport(24);
    const right = ladderReport(24, "godot-web");
    const second = rung({ ...right.rungs[1], positionHash: "deadbeef", repeat: 1 });
    right.rungs = [...right.rungs.slice(0, 2), second, ...right.rungs.slice(2)];
    left.rungs = [
      ...left.rungs.slice(0, 2),
      rung({ ...left.rungs[1], repeat: 1 }),
      ...left.rungs.slice(2),
    ];
    const fields = checkEquivalence(left, right).map((failure) => failure.field);
    expect(fields.some((field) => field.startsWith("positionHash"))).toBe(true);
  });

  it("should refuse an arm whose frame interval is display-pinned rather than load-following", () => {
    // Godot's Android export ignored VSYNC_DISABLED and read ~19 ms at every rung of a 16x ladder.
    // The requested `display.vsync` said false, so the flatness has to be caught in the samples.
    const pinned = ladderReport(24, "godot-web");
    pinned.rungs = pinned.rungs.map((entry) => ({ ...entry, frameMs: series(19) }));
    const fields = checkEquivalence(ladderReport(24), pinned).map((failure) => failure.field);
    expect(fields.some((field) => field.includes("display-pinned"))).toBe(true);
    // Two arms that both follow the load are comparable and must not trip it.
    expect(
      checkEquivalence(ladderReport(24), ladderReport(30, "godot-web")).some((failure) =>
        failure.field.includes("display-pinned"),
      ),
    ).toBe(false);
  });

  it("should refuse a release arm compared against a debug arm", () => {
    const right = ladderReport(24, "godot-web");
    right.build = { notes: "", type: "debug" };
    expect(checkEquivalence(ladderReport(24), right).map((failure) => failure.field)).toContain(
      "build.type",
    );
  });

  it("should refuse two arms whose displays disagree", () => {
    const right = ladderReport(24, "godot-web");
    right.display = { ...right.display, refreshHz: 120 };
    expect(checkEquivalence(ladderReport(24), right).map((failure) => failure.field)).toContain(
      "display.refreshHz",
    );
  });

  it("should refuse an L1 rung that silently auto-batched on one arm", () => {
    const right = ladderReport(24, "godot-web");
    right.rungs[3] = rung({ ...right.rungs[3], drawCalls: 1 });
    const fields = checkEquivalence(ladderReport(24), right).map((failure) => failure.field);
    expect(fields.some((field) => field.startsWith("drawCalls"))).toBe(true);
  });

  it("should refuse two arms whose triangle counts are more than 5% apart", () => {
    const right = ladderReport(24, "godot-web");
    right.rungs[0] = rung({ ...right.rungs[0], triangles: 6000 });
    const fields = checkEquivalence(ladderReport(24), right).map((failure) => failure.field);
    expect(fields.some((field) => field.startsWith("triangles"))).toBe(true);
  });

  it("should publish a comparison when both arms agree on the scene", () => {
    const comparison = compare(ladderReport(24), ladderReport(30, "godot-web"));
    expect(comparison.leftKnee.L1).toBe(4096);
    expect(comparison.rightKnee.L1).toBe(4096);
    expect(checkEquivalence(ladderReport(24), ladderReport(30, "godot-web"))).toEqual([]);
  });

  it("should refuse a provisional comparison", () => {
    const left = ladderReport(24);
    left.provisional = ["battery"];
    expect(() => compare(left, ladderReport(30, "godot-web"))).toThrow(
      /TN_BENCH_PROVISIONAL_COMPARISON/,
    );
  });

  it("should fail closed when Android comparison provisional arrays disagree", () => {
    const left = ladderReport(24, "tn-android");
    const condition = {
      batteryPercent: 80,
      charging: false,
      chargingSource: "NONE",
      provisional: [],
      screenOn: true,
      serial: "37251FDJH0037Z",
      thermalStatus: "NONE",
      thermalStatusCode: 0,
    };
    left.deviceCondition = condition;
    left.provisional = [];
    const right = ladderReport(30, "godot-android");
    right.deviceCondition = { ...condition, provisional: ["battery"] };
    right.provisional = [];
    expect(() => compare(left, right)).toThrow(/TN_BENCH_BAD_SHAPE/);
    expect(() => compare({ ...left, provisional: undefined }, right)).toThrow(/TN_BENCH_BAD_SHAPE/);
    expect(() =>
      compare(
        { ...left, provisional: ["battery"] },
        { ...right, deviceCondition: { ...condition, provisional: [] } },
      ),
    ).toThrow(/TN_BENCH_BAD_SHAPE/);
  });
});

describe("engine load test frozen-scene detection", () => {
  it("should refuse a device run below the battery floor unless it is asked for", async () => {
    // A phone under ~50% throttles, and the resulting number describes the battery. The escape hatch
    // exists because two arms at the same low charge still compare, but it has to be requested.
    const drained = { batteryPercent: 21, serial: "37251FDJH0037Z" };
    const charged = { batteryPercent: 74, serial: "37251FDJH0037Z" };
    const gate = (state: { batteryPercent: number }, allow: boolean): boolean =>
      state.batteryPercent >= MINIMUM_BATTERY_PERCENT || allow;
    expect(gate(drained, false)).toBe(false);
    expect(gate(drained, true)).toBe(true);
    expect(gate(charged, false)).toBe(true);
    expect(MINIMUM_BATTERY_PERCENT).toBe(50);
  });

  it("should read a frame interval that ignores load as the display, not the engine", () => {
    // Both a 120 Hz phone and a vsync-locked desktop host produce this shape, and it is the reason
    // an 8.2 ms mobile frame is reported as "fits inside one frame" rather than as a measured cost.
    const pinned = ladderReport(24, "godot-web");
    pinned.rungs = pinned.rungs.map((entry) => ({ ...entry, frameMs: series(8.3) }));
    expect(looksVsyncPinned(summarize(pinned), "L1")).toBe(true);
    expect(looksVsyncPinned(summarize(ladderReport(24)), "L1")).toBe(false);
  });
});

describe("engine load test desktop capture", () => {
  // The native desktop host prints its report, finishes its main loop, reaches `_exit` — and then
  // spins in userspace instead of terminating. A capture that waited for process exit therefore
  // hung forever with the finished report already sitting in its buffer, which read as "the
  // benchmark is slow" rather than "the benchmark is done". The report ends at the END marker, so
  // that is the completion signal; the process is killed after it.
  it("should return once the report marker lands, even if the host never exits", async () => {
    const report = { hello: "world" };
    const script = [
      `echo ${BEGIN_MARKER}`,
      `echo TNJSON:'${JSON.stringify(report)}'`,
      `echo ${END_MARKER}`,
      "sleep 300",
    ].join("; ");
    const started = Date.now();
    const parsed = await runCapturing("sh", ["-c", script], { cwd: process.cwd() });
    expect(parsed).toEqual(report);
    // The fixture sleeps for five minutes; anything near that means exit was waited on.
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 60_000);

  it("should still fail closed when a host exits without ever emitting a report", async () => {
    await expect(
      runCapturing("sh", ["-c", "echo nothing useful"], { cwd: process.cwd() }),
    ).rejects.toThrow(/TN_BENCH_NO_REPORT/);
  }, 30_000);
});

describe("the performance baseline gate", () => {
  // The realistic Android regression is not drift, it is the engine default reverting: 8.34 ms to
  // 101.24 ms on the same rung. Every case below is shaped around catching that cliff without
  // becoming a false-alarm generator on ordinary device noise.
  const BASELINES = {
    "tn-android": {
      evidence: "docs/verification/prd-130-phase-6-2026-08-16.md",
      rungs: { "L2@4096": 8.27, "L3@16384": 8.34 },
    },
  } as const;

  function androidReport(
    l2Ms: number,
    l3Ms: number,
    overrides: Partial<IRunReport> = {},
  ): IRunReport {
    return report({
      arm: "tn-android",
      display: { height: 720, refreshHz: 120, vsync: true, width: 1280 },
      rungs: [
        rung({ frameMs: series(l2Ms), mode: "L2", objectCount: 4096 }),
        rung({ frameMs: series(l3Ms), mode: "L3", objectCount: 16_384 }),
      ],
      ...overrides,
    });
  }

  it("passes a run that holds its recorded numbers", () => {
    const check = checkPerformance(androidReport(8.27, 8.34), BASELINES);
    expect(check?.regressions).toEqual([]);
    expect(check?.checked).toEqual(["L2@4096", "L3@16384"]);
    expect(check?.evidence).toBe("docs/verification/prd-130-phase-6-2026-08-16.md");
  });

  it("catches the engine reverting to QuickJS, which is what it exists for", () => {
    // The measured QuickJS numbers from the same device and bundle.
    const check = checkPerformance(androidReport(20.61, 101.24), BASELINES);
    expect(check?.regressions.map((row) => row.rung)).toEqual(["L2@4096", "L3@16384"]);
    const top = check?.regressions.find((row) => row.rung === "L3@16384");
    expect(top?.measuredMs).toBeCloseTo(101.24, 2);
    expect(top?.baselineMs).toBeCloseTo(8.34, 2);
  });

  it("tolerates device noise below the threshold and fails above it", () => {
    // Set so an ordinary noisy afternoon does not cry wolf: a tight bound produces a gate people
    // learn to ignore, which is worse than no gate.
    expect(PERFORMANCE_REGRESSION_TOLERANCE).toBe(0.25);
    const justUnder = 8.34 * 1.24;
    const justOver = 8.34 * 1.26;
    expect(checkPerformance(androidReport(8.27, justUnder), BASELINES)?.regressions).toEqual([]);
    expect(
      checkPerformance(androidReport(8.27, justOver), BASELINES)?.regressions.map(
        (row) => row.rung,
      ),
    ).toEqual(["L3@16384"]);
  });

  it("fails when the run stopped measuring a rung the baseline names", () => {
    // The quiet way a regression hides: drop the expensive rung and every remaining number looks
    // fine. Skipping it would be the v1 harness defect -- an assertion set that shrank to nothing
    // and reported pass.
    const missingTopRung = report({
      arm: "tn-android",
      rungs: [rung({ frameMs: series(8.27), mode: "L2", objectCount: 4096 })],
    });
    expect(() => checkPerformance(missingTopRung, BASELINES)).toThrow(
      /TN_BENCH_BASELINE_RUNG_MISSING.*L3@16384/su,
    );
  });

  it("refuses a provisional run rather than letting it clear the bar", () => {
    // PRD-127's override writes the condition into the report. A number taken outside its declared
    // conditions cannot satisfy a budget, for the same reason `compare` refuses one.
    const provisional = androidReport(8.27, 8.34, { provisional: ["charging"] });
    expect(() => checkPerformance(provisional, BASELINES)).toThrow(
      /TN_BENCH_PROVISIONAL_BASELINE.*charging/su,
    );
  });

  it("says nothing about an arm that has no recorded baseline", () => {
    // Silence, not a pass: an arm nobody has measured must not appear to have met a budget.
    expect(checkPerformance(report({ arm: "tn-web" }), BASELINES)).toBeUndefined();
  });

  it("rejects a missing baseline when the caller marks the lane required", () => {
    expect(() =>
      checkPerformance(report({ arm: "tn-web" }), {}, undefined, { required: true }),
    ).toThrow(/TN_BENCH_BASELINE_MISSING/u);
  });

  it("rejects empty and cross-device evidence in required mode", () => {
    const empty = {
      "tn-android": {
        evidence: "docs/verification/accepted.md",
        rungs: {},
        status: "accepted" as const,
      },
    };
    expect(() =>
      checkPerformance(androidReport(8.27, 8.34), empty, undefined, { required: true }),
    ).toThrow(/TN_BENCH_BASELINE_EMPTY/u);
    const otherDevice = {
      "tn-android": {
        evidence: "docs/verification/accepted.md",
        identity: { device: "different-device" },
        rungs: { "L2@4096": 8.27, "L3@16384": 8.34 },
        status: "accepted" as const,
      },
    };
    expect(() =>
      checkPerformance(androidReport(8.27, 8.34), otherDevice, undefined, { required: true }),
    ).toThrow(/TN_BENCH_BASELINE_IDENTITY_MISMATCH/u);
  });

  it("requires every provenance field for a required baseline candidate", () => {
    const provenance = {
      architecture: "arm64",
      artifactHash: "accepted-artifact",
      browser: "none",
      device: "desktop-chrome-linux",
      graphicsBackend: "vulkan",
      gpu: "accepted-gpu",
      instrumentationRevision: "accepted-instrumentation",
      jsRuntime: "v8",
      nativeBinaryHash: "accepted-binary",
      operatingSystem: "linux",
      presentMode: "immediate",
      resolution: "1280x720",
      sourceSha: "accepted-source",
      workloadHash: "accepted-workload",
    };
    const baseline = {
      "tn-android": {
        evidence: "docs/verification/accepted.md",
        identity: provenance,
        rungs: { "L2@4096": 8.27, "L3@16384": 8.34 },
        status: "accepted" as const,
      },
    };
    for (const field of ["sourceSha", "artifactHash", "nativeBinaryHash"] as const) {
      const value = { ...provenance, [field]: undefined };
      expect(() =>
        checkPerformance(androidReport(8.27, 8.34, { identity: value }), baseline, undefined, {
          required: true,
        }),
      ).toThrow(/TN_BENCH_BASELINE_IDENTITY_(?:MISSING|MISMATCH)/u);
    }
  });

  it("evaluates a genuine candidate with fresh provenance when stable identity matches", () => {
    const baselineIdentity = {
      architecture: "arm64",
      artifactHash: "accepted-artifact",
      browser: "none",
      device: "desktop-chrome-linux",
      graphicsBackend: "vulkan",
      gpu: "accepted-gpu",
      instrumentationRevision: "accepted-instrumentation",
      jsRuntime: "v8",
      nativeBinaryHash: "accepted-binary",
      operatingSystem: "linux",
      presentMode: "immediate",
      resolution: "1280x720",
      sourceSha: "accepted-source",
      workloadHash: "accepted-workload",
    };
    const baseline = {
      "tn-android": {
        evidence: "docs/verification/accepted.md",
        identity: baselineIdentity,
        rungs: { "L2@4096": 8.27, "L3@16384": 8.34 },
        status: "accepted" as const,
      },
    };
    const candidate = {
      ...baselineIdentity,
      artifactHash: "candidate-artifact",
      nativeBinaryHash: "candidate-binary",
      sourceSha: "candidate-source",
    };
    const check = checkPerformance(
      androidReport(8.27, 8.34, { identity: candidate }),
      baseline,
      undefined,
      { required: true },
    );
    expect(check?.regressions).toEqual([]);
    expect(() =>
      checkPerformance(
        androidReport(8.27, 8.34, {
          identity: { ...candidate, gpu: "different-gpu" },
        }),
        baseline,
        undefined,
        { required: true },
      ),
    ).toThrow(/TN_BENCH_BASELINE_IDENTITY_MISMATCH/u);
  });

  it("refuses a negative tolerance instead of inverting the comparison", () => {
    expect(() => checkPerformance(androidReport(8.27, 8.34), BASELINES, -0.1)).toThrow(
      /TN_BENCH_BAD_TOLERANCE/u,
    );
  });

  it("ships a baseline for the Android arm, citing the run that produced it", () => {
    // A baseline with no evidence path is a number nobody can check the conditions of.
    const android = PERFORMANCE_BASELINES["tn-android"];
    expect(android).toBeDefined();
    expect(android?.evidence).toMatch(/^docs\/verification\/.+\.md$/u);
    expect(Object.keys(android?.rungs ?? {})).toContain("L3@16384");
    // The recorded figure is vsync-bound at 120 Hz, so it is a ceiling on V8's real cost. If this
    // ever drops materially below the frame interval, the arm stopped being display-bound and the
    // baseline should be re-derived rather than nudged.
    expect(android?.rungs["L3@16384"]).toBeLessThan(1000 / 120 + 0.5);
  });
});

describe("the emulator canary", () => {
  // Measured 2026-08-17 rather than assumed: an emulator CAN catch an engine revert, and its absolute
  // numbers are worthless as performance figures. Both halves are load-bearing.
  const EMULATOR_V8 = { "L2@4096": 75.17, "L2@16384": 204.08, "L3@4096": 48.03, "L3@16384": 65.76 };
  const PHONE_V8 = { "L2@4096": 8.27, "L2@16384": 8.21, "L3@4096": 8.29, "L3@16384": 8.34 };

  function condition(serial: string): NonNullable<IRunReport["deviceCondition"]> {
    return {
      batteryPercent: serial.startsWith("emulator-") ? 100 : 80,
      charging: serial.startsWith("emulator-"),
      chargingSource: serial.startsWith("emulator-") ? "AC" : "none",
      provisional: [],
      screenOn: true,
      serial,
      thermalStatus: "NONE",
      thermalStatusCode: 0,
    };
  }

  function androidRun(serial: string, p50s: Record<string, number>): IRunReport {
    return report({
      arm: "tn-android",
      deviceCondition: condition(serial),
      display: { height: 720, refreshHz: 120, vsync: true, width: 1280 },
      rungs: Object.entries(p50s).map(([key, ms]) => {
        const [mode, count] = key.split("@");
        return rung({
          frameMs: series(ms),
          mode: mode as IRunReport["rungs"][number]["mode"],
          objectCount: Number(count),
        });
      }),
    });
  }

  it("compares an emulator run against the emulator baseline, not the phone's", () => {
    // The phone's top rung is 8.34 ms and the emulator's is 65.76 for the same work. Crossing the two
    // would report a regression on every emulator run and a pass on nothing.
    const check = checkPerformance(androidRun("emulator-5554", EMULATOR_V8));
    expect(check?.arm).toBe("tn-android@emulator");
    expect(check?.regressions).toEqual([]);
  });

  it("still catches the engine reverting, on three rungs of four", () => {
    // The QuickJS numbers measured on the same emulator. The ratio at the top rung falls to 2.4x from
    // the phone's 12.1x, because swiftshader is a CPU rasteriser and software rendering swamps script
    // time.
    const check = checkPerformance(
      androidRun("emulator-5554", {
        "L2@4096": 87.75,
        "L2@16384": 299.19,
        "L3@4096": 70.36,
        "L3@16384": 158.0,
      }),
    );
    expect(check?.regressions.map((row) => row.rung).sort()).toEqual([
      "L2@16384",
      "L3@16384",
      "L3@4096",
    ]);

    // **And this is the canary's honest limit, asserted so nobody has to rediscover it.** L2@4096
    // moves only 75.17 -> 87.75 ms, 1.2x, which fits inside the 25% tolerance and does not trip. On
    // the phone that rung moves 2.5x and does. So the emulator is a tripwire with three working
    // strands, not four, and a subtler regression than a whole-engine revert may well cross it
    // unnoticed. That is the price of a gate that runs without a phone.
    expect(check?.regressions.map((row) => row.rung)).not.toContain("L2@4096");
  });

  it("does not let a phone report be judged against the emulator budget", () => {
    // A phone reading the emulator's numbers is an eight-fold regression and must not pass because the
    // emulator is allowed to be that slow.
    const check = checkPerformance(androidRun("37251FDJH0037Z", EMULATOR_V8));
    expect(check?.arm).toBe("tn-android");
    expect(check?.regressions.length).toBe(4);
  });

  it("holds the phone baseline for a phone serial", () => {
    const check = checkPerformance(androidRun("37251FDJH0037Z", PHONE_V8));
    expect(check?.arm).toBe("tn-android");
    expect(check?.regressions).toEqual([]);
  });
});
