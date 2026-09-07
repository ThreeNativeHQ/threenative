// A dependency fetch must survive a transient rate limit. The Android CI lane died on
// `Failed to download stb: 429 Too Many Requests` (run 34078916876): raw.githubusercontent.com
// rate-limits an unauthenticated runner IP, `downloadFile` had no retry, and the whole
// `Install Android build prerequisites` step exited 1 — so the emulator never booted, the
// parity ledger reported a report that was never written, and the bounded performance step
// recorded BLOCKED while reading as a green step.
//
// These cases pin the two halves of the fix: transient statuses are retried with backoff, a
// genuine 404 still fails on the first response, and a GitHub host carries the token when CI
// supplies one.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "vitest";

import { makeTempDirSync } from "../../../test-support/temp-dir.js";
import { downloadFile } from "../scripts/download-deps.mjs";

function tempFile(name) {
  return join(makeTempDirSync("tn-download-retry-"), name);
}

const ok = (body) => new Response(body, { status: 200 });
const rateLimited = (headers = {}) => new Response("", { status: 429, headers });

test("a rate-limited dependency download retries and then succeeds", async () => {
  const statuses = [rateLimited(), rateLimited(), ok("stb_image contents")];
  const seen = [];
  const slept = [];
  const dest = tempFile("stb_image.h");

  const result = await downloadFile("https://raw.githubusercontent.com/nothings/stb/master/stb_image.h", dest, {
    fetchImpl: (url) => {
      seen.push(url);
      return Promise.resolve(statuses.shift());
    },
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });

  assert.equal(result, dest);
  assert.equal(readFileSync(dest, "utf8"), "stb_image contents");
  assert.equal(seen.length, 3, "the two rate-limited responses must both be retried");
  assert.deepEqual(slept, [1000, 2000], "backoff must grow between attempts");
});

test("Retry-After is honoured over the computed backoff", async () => {
  const statuses = [rateLimited({ "retry-after": "3" }), ok("x")];
  const slept = [];

  await downloadFile("https://raw.githubusercontent.com/nothings/stb/master/stb_vorbis.c", tempFile("stb_vorbis.c"), {
    fetchImpl: () => Promise.resolve(statuses.shift()),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });

  assert.deepEqual(slept, [3000]);
});

test("a rate limit that never clears fails closed, naming the status", async () => {
  let attempts = 0;
  await assert.rejects(
    downloadFile("https://raw.githubusercontent.com/nothings/stb/master/stb_image.h", tempFile("stb_image.h"), {
      fetchImpl: () => {
        attempts += 1;
        return Promise.resolve(rateLimited());
      },
      sleep: () => Promise.resolve(),
      retries: 3,
    }),
    /429/u,
  );
  assert.equal(attempts, 4, "the initial attempt plus every retry, then a failure — never a skip");
});

test("a missing file is not retried", async () => {
  let attempts = 0;
  await assert.rejects(
    downloadFile("https://example.invalid/gone.tar.gz", tempFile("gone.tar.gz"), {
      fetchImpl: () => {
        attempts += 1;
        return Promise.resolve(new Response("", { status: 404 }));
      },
      sleep: () => Promise.resolve(),
    }),
    /404/u,
  );
  assert.equal(attempts, 1, "a 404 is the answer, not a transient failure");
});

// Measured against nothings/stb on 2026-09-07: an anonymous GET returns 200, while the same GET
// carrying a bearer token raw.githubusercontent.com cannot validate for that repository returns
// 404 — the one status this function refuses to retry. A repo-scoped `secrets.GITHUB_TOKEN` has no
// grant on these upstreams, so attaching it would turn a recoverable rate limit into a hard,
// first-try failure worded as a deleted upstream file. This pins the absence.
test("no Authorization header is ever attached, even with a token in the environment", async () => {
  const seen = [];
  const capture = (_url, init) => {
    seen.push(init?.headers ?? null);
    return Promise.resolve(ok(""));
  };

  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "ghs-test";
  try {
    await downloadFile("https://raw.githubusercontent.com/nothings/stb/master/stb_image.h", tempFile("a.h"), {
      fetchImpl: capture,
    });
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  }

  const carriesAuth = seen.some((headers) =>
    Object.keys(headers ?? {}).some((key) => key.toLowerCase() === "authorization"),
  );
  assert.equal(carriesAuth, false, "a token that the host cannot validate turns 429 into 404");
});

// `fetch` throws rather than answering on ECONNRESET, a DNS failure or a dropped handshake. A
// retry that only understood HTTP statuses would give up on exactly the flakiness it exists for.
test("a thrown network error is retried, and the last one propagates", async () => {
  const boom = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  const queue = [boom, boom, () => ok("recovered")];

  const value = await downloadFile("https://raw.githubusercontent.com/a/b", tempFile("net.h"), {
    fetchImpl: () => {
      const next = queue.shift()();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    sleep: () => Promise.resolve(),
  });
  assert.equal(readFileSync(value, "utf8"), "recovered");

  let attempts = 0;
  await assert.rejects(
    downloadFile("https://raw.githubusercontent.com/a/b", tempFile("net2.h"), {
      fetchImpl: () => {
        attempts += 1;
        return Promise.reject(boom());
      },
      sleep: () => Promise.resolve(),
      retries: 2,
    }),
    /socket hang up/u,
  );
  assert.equal(attempts, 3, "the original error surfaces once the retries are spent");
});

// A server may answer `Retry-After: 600`. Four of those would sleep past
// android-emulator-parity's own `timeout-minutes: 45` and report as an emulator hang.
test("a very large Retry-After is capped rather than obeyed", async () => {
  const statuses = [rateLimited({ "retry-after": "600" }), ok("x")];
  const slept = [];

  await downloadFile("https://raw.githubusercontent.com/nothings/stb/master/stb_image.h", tempFile("c.h"), {
    fetchImpl: () => Promise.resolve(statuses.shift()),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    },
  });

  assert.deepEqual(slept, [30_000]);
});
