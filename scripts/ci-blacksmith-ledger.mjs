import {
  ORGANIZATION,
  decide,
  estimatedUnits,
  hosted,
  integer,
  requestIdentity,
} from "./ci-blacksmith-policy.mjs";

const STATES = [
  "reserved",
  "running",
  "completed-unreconciled",
  "settled",
  "confirmed-never-started",
];
const TERMINAL = ["settled", "confirmed-never-started"];
export function reservationKey(request) {
  const identity = requestIdentity(request);
  return [
    identity.organization,
    identity.period,
    identity.repository,
    identity.runId,
    identity.attempt,
    identity.candidate,
    identity.workflow,
    identity.job,
    identity.matrix,
  ].join(":");
}
function validated(ledger) {
  if (
    ledger?.version !== 1 ||
    ledger.organization !== ORGANIZATION ||
    !ledger.entries ||
    Array.isArray(ledger.entries) ||
    typeof ledger.entries !== "object" ||
    !ledger.snapshots ||
    Array.isArray(ledger.snapshots) ||
    typeof ledger.snapshots !== "object"
  )
    throw new Error("ledger-corrupt");
  for (const [key, entry] of Object.entries(ledger.entries)) {
    if (
      reservationKey(entry.request) !== key ||
      !STATES.includes(entry.state) ||
      entry.units !==
        estimatedUnits((entry.request.timeoutMinutes + entry.request.tailMinutes) * 60, 2)
    )
      throw new Error("ledger-corrupt");
  }
  for (const [period, snapshot] of Object.entries(ledger.snapshots)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/u.test(period)) throw new Error("ledger-corrupt");
    integer(snapshot.used);
    integer(snapshot.dataThrough);
  }
  return structuredClone(ledger);
}
// GitHub cancellation or elapsed lease alone never supplies either authority below.
export function reconcile(ledger, completion) {
  const next = validated(ledger);
  const entry = next.entries[completion.key];
  if (!entry) throw new Error("unknown-reservation");
  if (completion.state === "running" && entry.state === "reserved") entry.state = "running";
  else if (completion.state === "completed-unreconciled" && !TERMINAL.includes(entry.state))
    entry.state = "completed-unreconciled";
  else if (
    completion.state === "confirmed-never-started" &&
    entry.state === "reserved" &&
    completion.providerConfirmedNonBilling === true &&
    completion.exactKey === completion.key
  )
    entry.state = "confirmed-never-started";
  else throw new Error("completion-unverified");
  return next;
}
function observe(ledger, report) {
  const previous = Object.hasOwn(ledger.snapshots, report.period)
    ? ledger.snapshots[report.period]
    : undefined;
  if (previous && (report.used < previous.used || report.dataThrough < previous.dataThrough))
    throw new Error("usage-regressed");
  for (const key of report.includedKeys) {
    const entry = ledger.entries[key];
    if (!entry) continue; // The organization report also includes unenrolled repositories.
    if (
      entry.request.period !== report.period ||
      !["completed-unreconciled", "settled"].includes(entry.state)
    )
      throw new Error("usage-attribution-unverified");
    entry.state = "settled";
  }
  ledger.snapshots[report.period] = { used: report.used, dataThrough: report.dataThrough };
}
async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("deadline")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function admit(authority, request, report, config, now, { deadlineMs = 15000 } = {}) {
  const decision = decide(request, report, config, now);
  if (decision.provider !== "blacksmith" && decision.reason !== "insufficient-budget")
    return decision;
  try {
    const deadline = Date.now() + Math.min(15000, Math.max(1, integer(deadlineMs)));
    const identity = requestIdentity(request);
    const key = reservationKey(identity);
    for (let attempt = 0; attempt < 20; attempt++) {
      const before = await bounded(authority.read(), Math.max(1, deadline - Date.now()));
      if (Date.now() >= deadline) throw new Error("deadline");
      if (typeof before.sha !== "string" || before.sha.length === 0)
        throw new Error("ledger-corrupt");
      const next = validated(before.ledger);
      observe(next, report);
      const existing = next.entries[key];
      let fallback = decision.provider === "github" ? decision : undefined;
      if (
        existing &&
        JSON.stringify(requestIdentity(existing.request)) !== JSON.stringify(identity)
      )
        fallback = hosted("reservation-mismatch");
      if (existing && existing.state !== "reserved")
        fallback = hosted("reservation-already-dispatched");
      let exposure = report.used;
      for (const [entryKey, entry] of Object.entries(next.entries)) {
        if (TERMINAL.includes(entry.state)) continue;
        if (entry.request.period !== report.period) fallback = hosted("pending-reset-exposure");
        if (entryKey !== key) exposure = integer(exposure + entry.units);
      }
      if (!fallback && integer(exposure + decision.units) > decision.ceiling)
        fallback = hosted("insufficient-budget");
      if (!fallback && !existing)
        next.entries[key] = { request: identity, state: "reserved", units: decision.units };
      const committed = await bounded(
        authority.compareAndSwap(before.sha, next),
        Math.max(1, deadline - Date.now()),
      );
      if (Date.now() >= deadline) throw new Error("deadline");
      if (committed) return fallback ?? { ...decision, key };
    }
    return hosted("ledger-conflict");
  } catch (error) {
    return hosted(
      ["usage-regressed", "usage-attribution-unverified", "ledger-corrupt"].includes(error?.message)
        ? error.message
        : "provider-error",
    );
  }
}
// Deployment is intentionally absent. Only an independently pinned trusted controller may
// supply this token. Candidate jobs/workflows never call this adapter or receive its token.
export function createContentsLedger(token, fetcher = fetch) {
  if (typeof token !== "string" || token.length === 0) throw new Error("authority-unavailable");
  const url = "https://api.github.com/repos/ThreeNativeHQ/threenative/contents/budget.json";
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  return {
    async read() {
      const response = await fetcher(`${url}?ref=ci%2Fblacksmith-budget`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("ledger-read-unavailable");
      const body = await response.json();
      if (
        body.encoding !== "base64" ||
        typeof body.content !== "string" ||
        typeof body.sha !== "string"
      )
        throw new Error("ledger-corrupt");
      return {
        sha: body.sha,
        ledger: validated(JSON.parse(Buffer.from(body.content, "base64").toString("utf8"))),
      };
    },
    async compareAndSwap(sha, ledger) {
      if (typeof sha !== "string" || sha.length === 0) throw new Error("ledger-corrupt");
      const response = await fetcher(url, {
        method: "PUT",
        headers,
        signal: AbortSignal.timeout(15000),
        redirect: "error",
        body: JSON.stringify({
          message: "Update CI runner reservation ledger",
          branch: "ci/blacksmith-budget",
          sha,
          content: Buffer.from(JSON.stringify(validated(ledger))).toString("base64"),
        }),
      });
      if (response.status === 409 || response.status === 422) return false;
      if (!response.ok) throw new Error("ledger-write-unavailable");
      return true;
    },
  };
}
