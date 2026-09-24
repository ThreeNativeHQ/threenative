import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";

it("preserves both branding inspection and Windows release launch when branches reconcile", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/native-platforms.yml"), "utf8");
  const step = (name: string) => {
    const marker = `      - name: ${name}\n`;
    const start = workflow.indexOf(marker);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = workflow.indexOf("\n      - ", start + marker.length);
    return workflow.slice(start, next < 0 ? undefined : next);
  };
  expect(step("Inspect the release container's game brand")).toContain("--brand-only");
  for (const name of [
    "Verify the relocated release container with the installed verifier",
    "Launch the relocated container with no developer toolchain",
  ]) {
    expect(step(name), name).not.toContain("matrix.platform != 'Windows'");
  }
  const capture = step("Collect the release container's capture and report");
  expect(capture).toContain("if: always()");
  expect(capture).not.toContain("matrix.platform != 'Windows'");
  expect(capture).toContain('cygpath -u "$RUNNER_TEMP"');
  expect(capture).toContain("starter-container-report.json");
});

// PRD-365 phase 3 / owner decision 2026-09-23: each developer signs their own game, and the build
// signs with their credential. Windows proves it with `signtool /n`; macOS must prove it with
// `codesign`, or the platform the owner named stays unwired. This asserts the workflow would run
// both — the actual run is CI-only and stays open in the PRD until it happens.
it("proves release signing with test credentials on Windows and macOS", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/native-platforms.yml"), "utf8");
  const step = (name: string) => {
    const marker = `      - name: ${name}\n`;
    const start = workflow.indexOf(marker);
    expect(start, name).toBeGreaterThanOrEqual(0);
    const next = workflow.indexOf("\n      - ", start + marker.length);
    return workflow.slice(start, next < 0 ? undefined : next);
  };
  // The credential is generated on the runner and never shipped by the engine.
  expect(step("Create a self-signed code-signing certificate for the proof")).toContain(
    "if: matrix.platform == 'Windows'",
  );
  const macCertificate = step("Create a self-signed code-signing certificate for the macOS proof");
  expect(macCertificate).toContain("if: matrix.platform == 'macOS'");
  expect(macCertificate).toContain("extendedKeyUsage = codeSigning");
  expect(macCertificate).toContain('security import "$p12"');
  // The build itself signs with the test credential, exactly as the Windows leg passes its subject.
  const macBuild = step("Build the desktop release container");
  expect(macBuild).toContain(
    "THREENATIVE_DESKTOP_CODESIGN_IDENTITY='ThreeNative CI Signing Proof'",
  );
  expect(macBuild).not.toContain("THREENATIVE_DESKTOP_CODESIGN_IDENTITY=-");
  // The signature is read back independently of the adapter that wrote it.
  const macReadBack = step("Read the macOS signature back off the release container");
  expect(macReadBack).toContain("if: matrix.platform == 'macOS'");
  expect(macReadBack).toContain("true codesign");
  expect(macReadBack).toContain("codesign --verify --strict --deep");
  expect(macReadBack).toContain("Authority=ThreeNative CI Signing Proof");
  expect(step("Read the signature back off the artifact")).toContain("Get-AuthenticodeSignature");
});
