export interface IDocsPage {
  readonly path: string;
  readonly label: string;
  readonly group: "Start" | "Build" | "Ship" | "Understand" | "Evidence";
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly summary: string;
}

export const docsPages: readonly IDocsPage[] = [
  {
    path: "/docs",
    label: "Overview",
    group: "Start",
    eyebrow: "Documentation",
    title: "ThreeNative docs — build, verify and ship",
    description:
      "Start building with ThreeNative, understand how it differs from Three.js and full game engines, and inspect the evidence behind its performance claims.",
    summary: "The shortest path from an empty directory to a verified ThreeNative project.",
  },
  {
    path: "/docs/getting-started",
    label: "Getting started",
    group: "Start",
    eyebrow: "Start",
    title: "Getting started with ThreeNative",
    description:
      "Create a ThreeNative project, understand its scene and render structure, and run the same game source on the web and native runtime.",
    summary: "Install, scaffold a project, learn the file layout, then run the first playtest.",
  },
  {
    path: "/docs/core-concepts",
    label: "Core concepts",
    group: "Build",
    eyebrow: "Build",
    title: "Core runtime and game lifecycle",
    description:
      "Learn how defineGame, scenes, lifecycle methods, input, state and plugins form the portable ThreeNative game entry.",
    summary: "The small runtime contract that stays the same across browser and native targets.",
  },
  {
    path: "/docs/physics",
    label: "Physics",
    group: "Build",
    eyebrow: "Build",
    title: "Physics and portability",
    description:
      "Use ThreeNative's Godot-shaped Rapier physics nodes while keeping web and native portability boundaries explicit.",
    summary:
      "Rigid bodies, characters and collision shapes without leaking backend-specific handles.",
  },
  {
    path: "/docs/playtesting",
    label: "Playtesting",
    group: "Ship",
    eyebrow: "Verify",
    title: "Playtest the build you actually ship",
    description:
      "Drive ThreeNative browser and native builds with schema-versioned playtest scenarios and fail-closed assertions.",
    summary: "Turn movement, state, visibility and platform behavior into repeatable evidence.",
  },
  {
    path: "/docs/native-runtime",
    label: "Native runtime",
    group: "Ship",
    eyebrow: "Ship",
    title: "Run the same game entry natively",
    description:
      "Understand ThreeNative's optional native host, prebuilt runtime path, platform toolchains and portable entry contract.",
    summary:
      "Desktop and mobile builds without replacing your Three.js game source with a second API.",
  },
  {
    path: "/docs/comparison",
    label: "Compare engines",
    group: "Understand",
    eyebrow: "Why ThreeNative",
    title: "ThreeNative vs Three.js, Godot, Unity and Unreal Engine",
    description:
      "Compare ThreeNative with Three.js, Godot, Unity and Unreal Engine across authoring model, game systems, rendering control and deployment approach.",
    summary:
      "A constraint-by-constraint comparison, without pretending one engine fits every team.",
  },
  {
    path: "/docs/benchmarks",
    label: "Benchmarks",
    group: "Evidence",
    eyebrow: "Measured evidence",
    title: "ThreeNative benchmarks and verification",
    description:
      "Inspect ThreeNative benchmark results, runtime measurements and intentionally unscored experiments with links back to the retained repository evidence.",
    summary:
      "Published measurements, their scope, and the experiments that are still deliberately unscored.",
  },
];

export const docsGroups = ["Start", "Build", "Ship", "Understand", "Evidence"] as const;

export function docPageForPath(path: string): IDocsPage | undefined {
  return docsPages.find((page) => page.path === path);
}

export function docsNeighbours(path: string): {
  readonly previous?: IDocsPage;
  readonly next?: IDocsPage;
} {
  const index = docsPages.findIndex((page) => page.path === path);
  if (index < 0) return {};
  return {
    previous: index > 0 ? docsPages[index - 1] : undefined,
    next: index < docsPages.length - 1 ? docsPages[index + 1] : undefined,
  };
}
