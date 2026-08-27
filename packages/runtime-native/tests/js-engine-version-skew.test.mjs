// A two-major-version V8 skew between the desktop and Android hosts went unreported for the whole
// of PRD-222's optimization cycle, while an Android-only frame-rate defect was chased on desktop.
// Nothing in the repository compared the two pins. This test is that comparison.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(packageRoot, "js-engine-versions.json"), "utf8"));
const downloadDeps = readFileSync(join(packageRoot, "scripts", "download-deps.mjs"), "utf8");

/** The pinned version literal for one DEPS key, read from the only supported provisioning path. */
function pinnedVersion(depKey) {
  const key = depKey.includes("-") ? `'${depKey}'` : depKey;
  const block = downloadDeps.slice(downloadDeps.indexOf(`${key}: {`));
  assert.notEqual(block, "", `no DEPS entry for ${depKey} in download-deps.mjs`);
  const match = /version:\s*'([^']+)'/.exec(block);
  assert.ok(match, `no version pin for ${depKey} in download-deps.mjs`);
  return match[1];
}

/** V8's own major, read from an installed header. Returns undefined when deps are not provisioned. */
function installedMajor(dir) {
  const header = join(packageRoot, "third_party", dir, "include", "v8-version.h");
  if (!existsSync(header)) return undefined;
  const match = /#define V8_MAJOR_VERSION\s+(\d+)/.exec(readFileSync(header, "utf8"));
  return match ? Number(match[1]) : undefined;
}

describe("JavaScript engine version skew between platforms", () => {
  for (const [platform, engine] of Object.entries(manifest.engines)) {
    test(`${platform} pin matches download-deps.mjs`, () => {
      assert.equal(
        pinnedVersion(engine.depKey),
        engine.pin,
        `js-engine-versions.json records ${engine.pin} for ${platform}, but download-deps.mjs pins ` +
          `${pinnedVersion(engine.depKey)}. Update the manifest in the same change as the pin.`,
      );
    });

    test(`${platform} declared major matches the installed header when provisioned`, () => {
      const major = installedMajor(engine.depKey === "v8" ? "v8" : "v8-android");
      if (major === undefined) return; // native deps are opt-in; nothing to check
      assert.equal(
        major,
        engine.major,
        `${platform} third_party header reports V8 ${major}, manifest declares ${engine.major}.`,
      );
    });
  }

  test("skew between platforms stays within the acknowledged bound", () => {
    const { between, maxMajorSkew } = manifest.acknowledgedSkew;
    const [a, b] = between.map((name) => manifest.engines[name]);
    const skew = Math.abs(a.major - b.major);
    assert.equal(
      skew,
      manifest.acknowledgedSkew.majorSkew,
      `Recorded majorSkew is ${manifest.acknowledgedSkew.majorSkew} but the declared majors differ by ${skew}.`,
    );
    assert.ok(
      skew <= maxMajorSkew,
      `V8 major skew between ${between.join(" and ")} is ${skew}, above the acknowledged ${maxMajorSkew}. ` +
        `A wider skew makes cross-platform performance comparison invalid: ${manifest.acknowledgedSkew.consequence}`,
    );
  });

  test("an acknowledged skew states why it exists and what closes it", () => {
    const skew = manifest.acknowledgedSkew;
    if (skew.majorSkew === 0) return;
    for (const field of ["reason", "consequence", "closesWhen", "evidence"]) {
      assert.ok(
        typeof skew[field] === "string" && skew[field].length > 0,
        `An acknowledged engine skew must record "${field}".`,
      );
    }
  });

  test("a platform missing an optimizing tier the other has is recorded, not silent", () => {
    const [a, b] = manifest.acknowledgedSkew.between.map((n) => manifest.engines[n]);
    const missing = a.tiers.filter((t) => !b.tiers.includes(t))
      .concat(b.tiers.filter((t) => !a.tiers.includes(t)));
    if (missing.length === 0) return;
    assert.ok(
      manifest.acknowledgedSkew.reason.length > 0,
      `Platforms differ by optimizing tier (${missing.join(", ")}) with no recorded reason.`,
    );
  });
});
