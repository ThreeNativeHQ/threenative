/**
 * No shipped template may carry an asset the android target cannot decode.
 *
 * This is the publish gate for a whole class of bug. `templates/starter` shipped `pickup.ogg`,
 * which is the right format for the web and undecodable by the Android runtime's WAV-only
 * decoder — so **every project ever scaffolded from it** black-screened on `--target android`,
 * and nothing in the suite noticed. The failure had no symptom on device beyond a black
 * rectangle, because a rejected `decodeAudioData` rejects the promise `defineGame().start()` is
 * waiting on.
 *
 * The templates are the one asset directory this repository actually ships, so they are the one
 * it can hold to the standard the packager now enforces on consumers. A template that fails here
 * is a template that hands every new project a build it cannot ship.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- the packager's preflight is plain ESM with no type declarations.
import { findAndroidAssetProblems } from "../../runtime-native/scripts/asset-preflight.mjs";

const templatesRoot = fileURLToPath(new URL("../templates", import.meta.url));

const templates = readdirSync(templatesRoot).filter((entry) =>
  statSync(join(templatesRoot, entry)).isDirectory(),
);

describe("shipped templates", () => {
  it("ships at least one template, so an empty directory cannot pass silently", () => {
    expect(templates.length).toBeGreaterThan(0);
  });

  it.each(templates)("%s carries only assets the android target can decode", (template) => {
    const problems = findAndroidAssetProblems(join(templatesRoot, template)) as {
      file: string;
      reason: string;
      fix: string;
    }[];
    // The message is the value here: a bare count tells whoever broke it nothing.
    const report = problems.map((p) => `${p.file}: ${p.reason}\n  fix: ${p.fix}`).join("\n");
    expect(report).toBe("");
  });
});
