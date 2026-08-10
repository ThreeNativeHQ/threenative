import { assertCondition, startBehaviorScene } from "./scene-support.js";

export const LOCAL_ASSET_MARKER = "TN_LOCAL_ASSET_MARKER:v1\nkind=text-fixture\n";

export function assertLocalAssetProof(proof) {
  const expectedBytes = new TextEncoder().encode(LOCAL_ASSET_MARKER);
  assertCondition(proof.status === 200, `local fetch failed with status ${proof.status}`);
  assertCondition(proof.statusText === "OK", "local fetch must expose statusText OK");
  assertCondition(
    proof.contentType === "text/plain;charset=utf-8",
    "local fetch must preserve the Blob content type",
  );
  assertCondition(proof.text === LOCAL_ASSET_MARKER, "local fetch returned the wrong text marker");
  assertCondition(proof.bytes === expectedBytes.byteLength, "local fetch returned the wrong byte count");
  assertCondition(
    proof.decodedBytes === LOCAL_ASSET_MARKER,
    "local fetch arrayBuffer did not preserve exact UTF-8 bytes",
  );
  assertCondition(proof.revoked === true, "URL.revokeObjectURL must invalidate the local asset");
  return proof;
}

export async function fetchLocalAssetProof() {
  const encoded = new TextEncoder().encode(LOCAL_ASSET_MARKER);
  const url = URL.createObjectURL(
    new Blob([encoded], { type: "text/plain;charset=utf-8" }),
  );
  let proof;
  try {
    const textResponse = await fetch(new Request(url));
    const contentType = textResponse.headers.get("content-type");
    const text = await textResponse.text();
    const byteResponse = await fetch(new Request(url));
    const buffer = await byteResponse.arrayBuffer();
    proof = {
      bytes: buffer.byteLength,
      contentType,
      decodedBytes: new TextDecoder().decode(new Uint8Array(buffer)),
      status: textResponse.status,
      statusText: textResponse.statusText,
      text,
    };
  } finally {
    URL.revokeObjectURL(url);
  }

  let revoked = false;
  try {
    const revokedResponse = await fetch(new Request(url));
    revoked = revokedResponse.ok === false && revokedResponse.status === 404;
  } catch {
    revoked = true;
  }
  return assertLocalAssetProof({ ...proof, revoked });
}

export function startScene(canvas, dimensions) {
  return startBehaviorScene(canvas, dimensions, "fetch-local-asset", async () => {
    const proof = await fetchLocalAssetProof();
    return { status: proof.status, bytes: proof.bytes, revoked: proof.revoked };
  });
}
