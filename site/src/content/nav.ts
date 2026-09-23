import { findRoute } from "../routes.js";

const REPOSITORY = "https://github.com/ThreeNativeHQ/threenative";

/**
 * Where a navigation entry points. `pending` is the only entry that does not navigate, and it
 * must carry the reason it does not — a nav item that silently goes nowhere is the thing this
 * union exists to make impossible.
 */
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
  /** Present when the entry opens a menu; the chevron in the reference marks exactly these. */
  readonly items?: readonly INavItem[];
}

/** The centre nav from the reference, in the reference's order. */
export const primaryNav: readonly INavEntry[] = [
  {
    label: "Product",
    target: { kind: "pending", reason: "The product overview page is not written yet." },
    items: [
      {
        label: "Engine",
        summary: "The framework, its packages, and the conventions they ship on by default.",
        target: { kind: "external", href: `${REPOSITORY}#readme` },
      },
      {
        label: "Templates",
        summary: "Eight scaffolds that produce a running game, a HUD, and a playtest scenario.",
        target: {
          kind: "external",
          href: `${REPOSITORY}/blob/main/packages/create-threenative/README.md`,
        },
      },
      {
        label: "Native runtime",
        summary: "The owned C++ host for desktop, Android and iOS. No WebView.",
        target: { kind: "external", href: `${REPOSITORY}/tree/main/packages/runtime-native` },
      },
      {
        label: "Playtest",
        summary: "Drive the real build and assert what happened, on four platforms.",
        target: { kind: "external", href: `${REPOSITORY}/tree/main/packages/playtest` },
      },
    ],
  },
  {
    label: "Solutions",
    target: {
      kind: "pending",
      reason: "Nothing is written here yet, and an empty page is worse than an honest one.",
    },
  },
  {
    label: "Docs",
    target: { kind: "external", href: `${REPOSITORY}/tree/main/docs` },
  },
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
  {
    label: "Pricing",
    target: {
      kind: "pending",
      reason: "ThreeNative is MIT-licensed. There is nothing to price.",
    },
  },
];

/** The right-hand cluster. The reference shows a magnifier, an account link and the accent CTA. */
export const utilityNav: readonly INavEntry[] = [
  {
    label: "Search the source",
    target: {
      kind: "external",
      href: "https://github.com/search?q=repo%3AThreeNativeHQ%2Fthreenative&type=code",
    },
  },
  {
    label: "GitHub",
    target: { kind: "external", href: REPOSITORY },
  },
  {
    label: "Get Started",
    target: { kind: "anchor", hash: "#install" },
  },
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
        target: {
          kind: "external",
          href: `${REPOSITORY}/blob/main/packages/create-threenative/capabilities.json`,
        },
      },
    ],
  },
  ...primaryNav,
];

export function navHref(target: NavTarget): string | undefined {
  if (target.kind === "anchor") return target.hash;
  if (target.kind === "external") return target.href;
  if (target.kind === "internal") return target.path;
  return undefined;
}

/** Internal targets reachable from navigation, so a spec can prove each one prerenders. */
export function internalNavPaths(entries: readonly INavEntry[]): readonly string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    for (const target of [entry.target, ...(entry.items ?? []).map((item) => item.target)]) {
      if (target.kind === "internal") paths.push(target.path);
    }
  }
  return [...new Set(paths)];
}

/** Every label a renderer must be able to show, used as the header's coverage assertion. */
export function navLabels(entries: readonly INavEntry[]): readonly string[] {
  return entries.flatMap((entry) => [
    entry.label,
    ...(entry.items ?? []).map((item) => item.label),
  ]);
}

export function unresolvedInternalNavPaths(entries: readonly INavEntry[]): readonly string[] {
  return internalNavPaths(entries).filter((path) => findRoute(path) === undefined);
}
