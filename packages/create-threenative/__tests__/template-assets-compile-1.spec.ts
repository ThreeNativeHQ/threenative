/**
 * No shipped template may configure a compile pass off — first half of the sweep.
 *
 * The cases and the reason they exist live in `template-assets-compile-cases.ts`; this file is the
 * half of the template list `vitest --shard` sends here, and the other half's twin is
 * `template-assets-compile-2.spec.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  compilesUnderTheDefaultConfig,
  compilesWithCompressionOnByDefault,
  firstHalf,
  reachesTheUncookedBudgetWithAnEligibleSourceProbe,
  templates,
} from "./template-assets-compile-cases.js";

describe("shipped templates", () => {
  it.each(firstHalf)(
    "%s reaches the uncooked budget with an eligible source probe",
    reachesTheUncookedBudgetWithAnEligibleSourceProbe,
  );

  it("should name at least one template, or this gate is measuring nothing", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(firstHalf)(
    "%s should compile with compression on by default",
    compilesWithCompressionOnByDefault,
  );

  it.each(firstHalf)(
    "%s assets should compile under the default config",
    compilesUnderTheDefaultConfig,
  );
});
