import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

function assertPeerVerificationContract(candidate) {
  assert.match(
    candidate,
    /MYSTRAL_WEBTRANSPORT_INSECURE/u,
    "the insecure peer-verification override must have a named environment seam",
  );
  assert.match(
    candidate,
    /quiche_config_verify_peer\(s->config,\s*!allowInsecurePeerVerification\);/u,
    "peer verification must be enabled unless the explicit development override is active",
  );
  assert.match(
    candidate,
    /WARNING:[\s\S]*kInsecurePeerVerificationEnv/u,
    "using the insecure override must be visible in the runtime log",
  );
  assert.doesNotMatch(
    candidate,
    /quiche_config_verify_peer\(s->config,\s*false\).*TODO/u,
    "the old unconditional insecure setting and serverCertificateHashes TODO must be gone",
  );
  assert.match(
    candidate,
    /bool isTruthyEnvironmentValue\(const char\* value\) \{[\s\S]*?return value != nullptr && std::string\(value\) == "1";/u,
    "the development override must accept only the documented exact value 1",
  );
  assert.doesNotMatch(
    candidate,
    /std::string\(value\) == "true"|std::string\(value\) == "TRUE"/u,
    "truthy aliases must not disable TLS peer verification",
  );
  assertModeLogContract(candidate);
}

function assertModeLogContract(candidate) {
  assert.match(
    candidate,
    /TLS peer verification mode:[\s\S]*allowInsecurePeerVerification \? "insecure-override" : "verify-peer"/u,
    "the runtime must log the mode that was actually parsed",
  );
}

test("WebTransport verifies TLS peers by default and documents the dev override", () => {
  const source = read("src/webtransport/webtransport.cpp");
  const cli = read("src/cli/main.cpp");

  assert.doesNotThrow(() => assertPeerVerificationContract(source));
  assert.match(
    cli,
    /MYSTRAL_WEBTRANSPORT_INSECURE=1[\s\S]*Development-only[\s\S]*exact value 1[\s\S]*other values/u,
    "the explicit override must be documented beside the runtime environment flags",
  );
});

test("peer verification contract rejects truthy aliases and missing mode logging", () => {
  const source = read("src/webtransport/webtransport.cpp");
  const truthyMutation = source.replace(
    'return value != nullptr && std::string(value) == "1";',
    'return value != nullptr && (std::string(value) == "1" || std::string(value) == "true");',
  );
  assert.throws(
    () => assertPeerVerificationContract(truthyMutation),
    /exact value 1|truthy aliases/u,
  );

  const exactParser = source.replace(
    /bool isTruthyEnvironmentValue\(const char\* value\) \{[\s\S]*?\n\}/u,
    'bool isTruthyEnvironmentValue(const char* value) {\n    return value != nullptr && std::string(value) == "1";\n}',
  );
  const withoutModeLog = exactParser.replace(
    /\s*std::cerr << "\[WebTransport\] TLS peer verification mode: "\n\s*<< \(allowInsecurePeerVerification \? "insecure-override" : "verify-peer"\)\n\s*<< " \(parsed from " << kInsecurePeerVerificationEnv << "="\n\s*<< \(insecurePeerVerificationValue \? insecurePeerVerificationValue : "<unset>"\)\n\s*<< "\)" << std::endl;\n/u,
    "\n",
  );
  assert.throws(
    () => assertModeLogContract(withoutModeLog),
    /actual parsed mode|must log the mode/u,
  );
});

test("live certificate fixture prerequisite has an explicit fail-closed mode", () => {
  const source = read("tests/webtransport/webtransport.test.ts");
  assert.match(source, /TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE === "1"/u);
  assert.match(
    source,
    /WebTransport live certificate fixture prerequisite failed: \$\{unavailableReason\}/u,
  );
});

test("peer verification contract rejects the old always-insecure mutation", () => {
  const source = read("src/webtransport/webtransport.cpp");
  const insecureMutation = source.replace(
    /quiche_config_verify_peer\(s->config,[^\n]+\);/u,
    "quiche_config_verify_peer(s->config, false);",
  );

  assert.throws(
    () => assertPeerVerificationContract(insecureMutation),
    /explicit development override|peer verification|TODO/u,
  );
});
