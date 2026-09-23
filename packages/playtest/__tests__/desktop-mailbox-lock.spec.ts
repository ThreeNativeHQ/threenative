import { beforeEach, expect, test, vi } from "vitest";

const fs = vi.hoisted(() => ({ readFile: vi.fn(), rm: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  readFile: fs.readFile,
  rm: fs.rm,
}));

const { LocalDeviceMailbox } = await import("../src/runner/desktop.js");

const coded = (code: string) => Object.assign(new Error(code), { code });

beforeEach(() => {
  fs.readFile.mockReset();
  fs.rm.mockReset();
});

// CI run 35818304207: the Windows starter HUD playtest died on EPERM lstat of
// tn-playtest-response.json while the native game was replacing it.
test("a Windows mailbox lock reads as not-yet-written so the poller retries", async () => {
  const mailbox = new LocalDeviceMailbox();
  fs.readFile.mockRejectedValueOnce(coded("EPERM")).mockRejectedValueOnce(coded("EBUSY"));
  expect(await mailbox.read("response.json")).toBeUndefined();
  expect(await mailbox.read("response.json")).toBeUndefined();
  fs.readFile.mockRejectedValueOnce(coded("EACCES"));
  await expect(mailbox.read("response.json")).rejects.toThrow("EACCES");
});

test("removing the mailbox file asks rm to retry a Windows lock", async () => {
  await new LocalDeviceMailbox().remove("response.json");
  expect(fs.rm).toHaveBeenCalledWith("response.json", expect.objectContaining({ force: true, maxRetries: expect.any(Number) }));
});
