import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";

import { DeviceBridgeTransport, validateDeviceEndpoint } from "../src/runner/deviceTransport.js";

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address() as AddressInfo;
  await new Promise<void>((resolve, reject) => probe.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

test("device transport correlates a polled request with its response", async () => {
  const endpoint = `http://127.0.0.1:${await freePort()}/playtest`;
  const transport = new DeviceBridgeTransport(endpoint);
  await transport.start();
  try {
    const connected = transport.waitForBridge(1_000);
    expect((await fetch(endpoint)).status).toBe(204);
    await expect(connected).resolves.toBe(true);

    const result = transport.call<{ ok: boolean }>("sample", { entities: ["player"] });
    const request = await fetch(endpoint);
    expect(request.status).toBe(200);
    const payload = (await request.json()) as { argument: unknown; id: string; method: string };
    expect(payload).toMatchObject({ argument: { entities: ["player"] }, method: "sample" });

    const response = await fetch(endpoint, {
      body: JSON.stringify({ id: payload.id, result: { ok: true } }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(204);
    await expect(result).resolves.toEqual({ ok: true });
  } finally {
    await transport.close();
  }
});

test("device endpoint validation rejects non-loopback or ambiguous endpoints", () => {
  expect(validateDeviceEndpoint("http://localhost:41777/playtest").pathname).toBe("/playtest");
  expect(() => validateDeviceEndpoint("https://127.0.0.1:41777/playtest")).toThrow(/http/u);
  expect(() => validateDeviceEndpoint("http://192.168.0.2:41777/playtest")).toThrow(/loopback/u);
  expect(() => validateDeviceEndpoint("http://127.0.0.1:41777/playtest?x=1")).toThrow(/query/u);
});
