import { describe, expect, it } from "vitest";
import {
  admit,
  createContentsLedger,
  reconcile,
  reservationKey,
} from "../ci-blacksmith-ledger.mjs";
import { control, ledger, now, observation, request } from "./ci-blacksmith-fixtures.js";

// Real in-memory SHA compare-and-swap semantics; admission itself is production code.
function store(initial = ledger()) {
  let state = structuredClone(initial);
  let version = 1;
  return {
    read: async () => ({ sha: String(version), ledger: structuredClone(state) }),
    compareAndSwap: async (sha: string, next: typeof initial) => {
      await Promise.resolve();
      if (sha !== String(version)) return false;
      state = structuredClone(next);
      version++;
      return true;
    },
    value: () => state,
  };
}
describe("organization-wide Blacksmith reservation CAS", () => {
  it("rereads after conflicts so twenty racers cannot overspend", async () => {
    const state = store();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        admit(state, request(String(i + 1)), observation(2380), control(2700), now),
      ),
    );
    expect(results.filter((r) => r.provider === "blacksmith")).toHaveLength(2);
    expect(Object.values(state.value().entries).reduce((sum, entry) => sum + entry.units, 0)).toBe(
      320,
    );
  });
  it("makes identical retries idempotent but rejects changed immutable fields", async () => {
    const state = store();
    const first = await admit(state, request(), observation(), control(), now);
    expect(await admit(state, request(), observation(), control(), now)).toEqual(first);
    expect(
      await admit(state, { ...request(), tailMinutes: 6 }, observation(), control(), now),
    ).toMatchObject({ provider: "github", reason: "reservation-mismatch" });
    expect(Object.keys(state.value().entries)).toHaveLength(1);
  });
  it("retains cancelled or completed exposure without authoritative billing attribution", async () => {
    const state = store();
    await admit(state, request(), observation(), control(), now);
    const key = reservationKey(request());
    const updated = reconcile(state.value(), { key, state: "completed-unreconciled" });
    expect(updated.entries[key]?.units).toBe(160);
    expect((await admit(store(updated), request("2"), observation(), control(), now)).reason).toBe(
      "insufficient-budget",
    );
    expect(() => reconcile(updated, { key, state: "confirmed-never-started" })).toThrow();
  });
  it("settles only exact-attempt provider attribution, without double counting", async () => {
    const state = store();
    await admit(state, request(), observation(), control(), now);
    const key = reservationKey(request());
    expect(() =>
      reconcile(state.value(), { key, state: "settled", includedKeys: [key] }),
    ).toThrow();
    const completed = reconcile(state.value(), { key, state: "completed-unreconciled" });
    const snapshot = { ...observation(20), includedKeys: [key] };
    expect((await admit(store(completed), request("2"), snapshot, control(), now)).provider).toBe(
      "blacksmith",
    );
  });
  it("rejects regressing reports and preserves unresolved prior periods", async () => {
    const state = store();
    await admit(state, request(), observation(100), control(), now);
    expect((await admit(state, request("2"), observation(90), control(), now)).reason).toBe(
      "usage-regressed",
    );
    expect(
      (
        await admit(
          state,
          { ...request("2"), period: "next" },
          { ...observation(), period: "next" },
          control(),
          now,
        )
      ).reason,
    ).toBe("pending-reset-exposure");
  });
  it("atomically persists high-water usage on idempotent and denied admissions", async () => {
    for (const retry of [true, false]) {
      const state = store();
      await admit(state, request(), observation(100), control(430), now);
      await admit(
        state,
        request(retry ? "1" : "2"),
        observation(retry ? 120 : 280),
        control(430),
        now,
      );
      expect((await admit(state, request("2"), observation(110), control(430), now)).reason).toBe(
        "usage-regressed",
      );
    }
  });
  it("treats persisted field ordering as identical identity", async () => {
    const state = store();
    await admit(state, request(), observation(), control(), now);
    const next = structuredClone(state.value());
    const entry = next.entries[reservationKey(request())];
    if (!entry) throw new Error("missing reserved fixture");
    entry.request = Object.fromEntries(
      Object.entries(entry.request).reverse(),
    ) as typeof entry.request;
    expect((await admit(store(next), request(), observation(), control(), now)).provider).toBe(
      "blacksmith",
    );
  });
  it.each(["periodStart", "periodEnd"])(
    "binds immutable %s to a provider period",
    async (field) => {
      const state = store();
      await admit(state, request(), observation(), control(), now);
      const before = structuredClone(state.value());
      const changed = {
        ...observation(),
        [field]: observation()[field as "periodStart" | "periodEnd"] - 1,
      };
      expect((await admit(state, request(), changed, control(), now)).provider).toBe("github");
      expect(state.value()).toEqual(before);
    },
  );
  it("hosts malformed deadlines instead of throwing from the scheduling boundary", async () => {
    expect(
      (await admit(store(), request(), observation(), control(), now, { deadlineMs: Number.NaN }))
        .provider,
    ).toBe("github");
  });
  it("hosts corrupt, unavailable, indefinitely conflicting or timed-out authorities", async () => {
    const invalid = [
      store({ ...ledger(), version: 2 }),
      {
        read: async () => {
          throw new Error("private token detail");
        },
      },
      { ...store(), compareAndSwap: async () => false },
    ];
    for (const authority of invalid)
      expect((await admit(authority, request(), observation(), control(), now)).provider).toBe(
        "github",
      );
    const hung = { read: () => new Promise<never>(() => {}) };
    expect(
      (await admit(hung, request(), observation(), control(), now, { deadlineMs: 5 })).reason,
    ).toBe("provider-error");
  });
  it("never touches the ledger in off/shadow/forced-hosted mode", async () => {
    const authority = {
      read: () => {
        throw new Error("must not touch");
      },
    };
    for (const config of [
      { ...control(), mode: "off" },
      { ...control(), mode: "shadow" },
      { ...control(), forceHosted: true },
    ]) {
      expect((await admit(authority, request(), observation(), config, now)).reason).not.toBe(
        "provider-error",
      );
    }
  });
  it("uses fixed state-ref Contents API SHA writes, never creates missing state", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const authority = createContentsLedger(
      "test-only-token",
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (init.method === "PUT") return new Response("", { status: 409 });
        return Response.json({
          sha: "old-sha",
          encoding: "base64",
          content: Buffer.from(JSON.stringify(ledger())).toString("base64"),
        });
      },
    );
    const before = await authority.read();
    expect(await authority.compareAndSwap(before.sha, ledger())).toBe(false);
    expect(calls[0]?.url).toBe(
      "https://api.github.com/repos/ThreeNativeHQ/threenative/contents/budget.json?ref=ci%2Fblacksmith-budget",
    );
    expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
      sha: "old-sha",
      branch: "ci/blacksmith-budget",
    });
    const missing = createContentsLedger(
      "test-only-token",
      async () => new Response("", { status: 404 }),
    );
    expect((await admit(missing, request(), observation(), control(), now)).provider).toBe(
      "github",
    );
  });
  it("rejects final billing with an inherited snapshot instead of an owned period", async () => {
    const corrupted = ledger();
    const identity = { ...request(), period: "constructor" };
    const key = reservationKey(identity);
    corrupted.entries[key] = {
      request: identity,
      state: "settled",
      units: 160,
      finalBilling: {
        key,
        billingComplete: true,
        billedPeriods: ["constructor"],
        billingEndedAt: now,
      },
    };
    const authority = createContentsLedger("test-only-token", async () =>
      Response.json({
        sha: "fixture-sha",
        encoding: "base64",
        content: Buffer.from(JSON.stringify(corrupted)).toString("base64"),
      }),
    );
    await expect(authority.read()).rejects.toThrow("ledger-corrupt");
  });
  it("does not recreate a lost period snapshot from a lower usage report", async () => {
    const state = store();
    await admit(state, request(), observation(100), control(430), now);
    const lost = structuredClone(state.value());
    lost.snapshots = {};
    const authority = store(lost);
    expect(await admit(authority, request(), observation(90), control(430), now)).toMatchObject({
      provider: "github",
      reason: "ledger-corrupt",
    });
    expect(authority.value()).toEqual(lost);
  });
});
