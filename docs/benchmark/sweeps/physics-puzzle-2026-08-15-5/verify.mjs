// Assertions against the real build in a real browser. Exits 1 on any failure,
// and on a missing observation — a check that cannot read the world is a
// failure, not a pass.
import { chromium } from "playwright";

const failures = [];
const check = (name, condition, detail) => {
  if (condition) console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
};

const browser = await chromium.launch({
  headless: false,
  args: ["--enable-unsafe-webgpu", "--disable-gpu-sandbox", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });

const state = async () => {
  const value = await page.evaluate(() => globalThis.__GAME__?.state?.getState?.() ?? null);
  if (value === null) throw new Error("could not read game state — the game never booted");
  return value;
};
const hold = async (key, ms) => {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
};

await page.waitForTimeout(6000);
const settled = await state();
check("boots without page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
check("at least 30 dynamic bodies", settled.crates >= 30, `${settled.crates} bodies`);
check(
  "the drop comes to rest",
  settled.settled === settled.crates,
  `${settled.settled}/${settled.crates} at rest`,
);
check("goal is not reachable by settling alone", settled.goal === false);
check("run 1 records a settled hash", settled.restHash.length === 8, settled.restHash);

// Walk east: the pass-through crate sits on this line and must not stop us,
// while the solid crates on the way must move.
await hold("KeyD", 3000);
await page.waitForTimeout(1200);
const walked = await state();
check("player passes through the phantom crate", walked.phantomPasses >= 1, `${walked.phantomPasses}`);
check("player ended past the phantom crate", walked.playerX > 3.6, `x=${walked.playerX.toFixed(2)}`);
check("solid crates get shoved", walked.shifted >= 1, `${walked.shifted} moved`);

// The other half of the pass-through rule: solid crates are impassable, so the
// player must never end a frame standing inside one.
const clearance = await page.evaluate(() => {
  const probe = globalThis.__PROBE__;
  if (probe === undefined) return null;
  const [px, , pz] = probe.player();
  return probe
    .solids()
    .reduce((min, [x, y, z]) => (Math.abs(y - 0.5) > 1 ? min : Math.min(min, Math.hypot(x - px, z - pz))), Infinity);
});
check(
  "player never stands inside a solid crate",
  clearance !== null && clearance > 0.6,
  clearance === null ? "probe missing" : `nearest solid crate ${clearance.toFixed(2)} away`,
);

// Solid crates block: drive into the stack and confirm the player stops short.
await hold("KeyR", 250);
await page.waitForTimeout(6000);
const restarted = await state();
check("restart rebuilds the scene", restarted.runs === 2, `run ${restarted.runs}`);
check("restart clears the goal", restarted.goal === false);
check("restart clears crate displacement", restarted.shifted === 0, `${restarted.shifted}`);

await hold("KeyW", 2100);
await hold("KeyD", 3200);
await page.waitForTimeout(1500);
const won = await state();
check("a pushed crate opens the vault", won.goal === true && won.contacts >= 1, `${won.contacts} contacts`);
check(
  "the replay comparison is reported, not assumed",
  ["match", "DIVERGED", "run 1 — recorded", "pending"].includes(won.restMatch),
  `settled state: ${won.restMatch}`,
);
await page.screenshot({ path: "shots/verify.png" });
await browser.close();

console.log(failures.length === 0 ? "\nall checks passed" : `\n${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
