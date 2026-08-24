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
}

test("WebTransport verifies TLS peers by default and documents the dev override", () => {
  const source = read("src/webtransport/webtransport.cpp");
  const cli = read("src/cli/main.cpp");

  assert.doesNotThrow(() => assertPeerVerificationContract(source));
  assert.match(
    cli,
    /MYSTRAL_WEBTRANSPORT_INSECURE=1[\s\S]*Development-only/u,
    "the explicit override must be documented beside the runtime environment flags",
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
