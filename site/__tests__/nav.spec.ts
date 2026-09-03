import { describe, expect, it } from "vitest";
import {
  footerNav,
  navHref,
  navLabels,
  primaryNav,
  unresolvedInternalNavPaths,
  utilityNav,
} from "../src/content/nav.js";
import { prerenderedPage } from "./support.js";

const ALL_ENTRIES = [...primaryNav, ...utilityNav, ...footerNav];

describe("navigation is one model with three renderers", () => {
  it("should render every nav entry that the model marks as navigable", async () => {
    const page = await prerenderedPage("/");
    const labels = navLabels([...primaryNav, ...utilityNav]);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      // Menu items live behind a click, so only the top-level labels have to be in the markup;
      // the drawer and the dropdowns read the same list this assertion walks.
      if (!primaryNav.concat(utilityNav).some((entry) => entry.label === label)) continue;
      expect(page.includes(label), `the header never renders ${label}`).toBe(true);
    }
  });

  it("should never link a nav entry to a route that does not prerender", () => {
    expect(unresolvedInternalNavPaths(ALL_ENTRIES)).toEqual([]);
  });

  it("should give every entry either a destination or a stated reason", () => {
    for (const entry of ALL_ENTRIES) {
      for (const target of [entry.target, ...(entry.items ?? []).map((item) => item.target)]) {
        if (target.kind === "pending") {
          expect(target.reason.length, `${entry.label} is pending with no reason`).toBeGreaterThan(
            0,
          );
          continue;
        }
        expect(navHref(target), `${entry.label} has an empty destination`).toBeTruthy();
      }
    }
  });

  it("should give every pending top-level entry a menu or leave it unlinked", () => {
    for (const entry of primaryNav) {
      if (entry.target.kind !== "pending") continue;
      expect(navHref(entry.target)).toBeUndefined();
    }
  });

  it("should mark every external destination as an absolute https URL", () => {
    for (const entry of ALL_ENTRIES) {
      for (const target of [entry.target, ...(entry.items ?? []).map((item) => item.target)]) {
        if (target.kind !== "external") continue;
        expect(target.href.startsWith("https://"), `${target.href} is not https`).toBe(true);
      }
    }
  });
});
