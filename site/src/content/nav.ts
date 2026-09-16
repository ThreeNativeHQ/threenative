import { findRoute } from "../routes.js";

const REPOSITORY = "https://github.com/ThreeNativeHQ/threenative";

/** Every entry has a destination or an explicit explanation; menu parents may be pending. */
export type NavTarget =
  | { readonly kind: "anchor"; readonly hash: string }
  | { readonly kind: "external"; readonly href: string }
  | { readonly kind: "internal"; readonly path: string }
  | { readonly kind: "pending"; readonly reason: string };

export interface INavItem {
  readonly label: string;
  readonly summary: string;
  readonly target: NavTarget;
}

export interface INavEntry {
  readonly label: string;
  readonly target: NavTarget;
  readonly items?: readonly INavItem[];
}

/** Comparisons and benchmarks live under Docs, never as extra top-level navigation. */
export const primaryNav: readonly INavEntry[] = [
  {
    label: "Product",
    target: { kind: "pending", reason: "Choose a product destination from the menu." },
    items: [
      {
        label: "Engine",
        summary: "The framework, its packages, and the conventions they ship on by default.",
        target: { kind: "external", href: `${REPOSITORY}#readme` },
      },
      {
        label: "Templates",
        summary: "Scaffolds with a running game, a HUD, and a playtest scenario.",
        target: { kind: "external", href: `${REPOSITORY}/blob/main/packages/create-threenative/README.md` },
      },
      {
        label: "Native runtime",
        summary: "The owned C++ host for desktop, Android and iOS. No WebView game surface.",
        target: { kind: "external", href: `${REPOSITORY}/tree/main/packages/runtime-native` },
      },
      {
        label: "Playtest",
        summary: "Drive the real build and assert what happened, on four platforms.",
        target: { kind: "external", href: `${REPOSITORY}/tree/main/packages/playtest` },
      },
    ],
  },
  { label: "Docs", target: { kind: "internal", path: "/docs" } },
  {
    label: "Community",
    target: { kind: "pending", reason: "Pick a destination from the menu." },
    items: [
      {
        label: "Discussions",
        summary: "Ask a question or show what you built.",
        target: { kind: "external", href: `${REPOSITORY}/discussions` },
      },
      {
        label: "Issues",
        summary: "Report a bug against a version and a platform.",
        target: { kind: "external", href: `${REPOSITORY}/issues` },
      },
      {
        label: "Contributing",
        summary: "How a change gets reviewed, and the gates it has to pass.",
        target: { kind: "external", href: `${REPOSITORY}/blob/main/CONTRIBUTING.md` },
      },
    ],
  },
];

export const utilityNav: readonly INavEntry[] = [
  {
    label: "Search the source",
    target: { kind: "external", href: "https://github.com/search?q=repo%3AThreeNativeHQ%2Fthreenative&type=code" },
  },
  { label: "GitHub", target: { kind: "external", href: REPOSITORY } },
  { label: "Get Started", target: { kind: "anchor", hash: "#install" } },
];

export const footerNav: readonly INavEntry[] = [
  {
    label: "Start",
    target: { kind: "anchor", hash: "#install" },
    items: [
      {
        label: "Install",
        summary: "One command, one running game.",
        target: { kind: "anchor", hash: "#install" },
      },
      {
        label: "Code sample",
        summary: "The portable entry point, compiled against the shipped package.",
        target: { kind: "anchor", hash: "#code" },
      },
      {
        label: "Capabilities",
        summary: "Every public export, searchable by situation.",
        target: { kind: "external", href: `${REPOSITORY}/blob/main/packages/create-threenative/capabilities.json` },
      },
    ],
  },
  ...primaryNav,
];

export function navHref(target: NavTarget): string | undefined {
  if (target.kind === "anchor") return `/${target.hash}`;
  if (target.kind === "external") return target.href;
  if (target.kind === "internal") return target.path;
  return undefined;
}

export function internalNavPaths(entries: readonly INavEntry[]): readonly string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    for (const target of [entry.target, ...(entry.items ?? []).map((item) => item.target)]) {
      if (target.kind === "internal") paths.push(target.path);
    }
  }
  return [...new Set(paths)];
}

export function navLabels(entries: readonly INavEntry[]): readonly string[] {
  return entries.flatMap((entry) => [entry.label, ...(entry.items ?? []).map((item) => item.label)]);
}

export function unresolvedInternalNavPaths(entries: readonly INavEntry[]): readonly string[] {
  return internalNavPaths(entries).filter((path) => findRoute(path) === undefined);
}
