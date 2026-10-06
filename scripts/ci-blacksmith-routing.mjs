import { appendFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HOSTED, hosted } from "./ci-blacksmith-policy.mjs";

// Unprivileged bootstrap: never reads tokens, account files, usage or ledger state.
// Candidate-controlled code/outputs cannot activate a privileged provider dispatch.
export function hostedRoute({ mode = "off", forceHosted, attempt, selection } = {}) {
  if (forceHosted === "true" || forceHosted === true) return hosted("forced-hosted");
  if (Number(attempt) > 1) return hosted("rerun");
  if (selection === "warm") return hosted("warm-unenrolled");
  if (mode === "" || mode === "off") return hosted("disabled");
  if (mode === "shadow") return hosted("shadow");
  return hosted(mode === "enforce" ? "activation-unverified" : "invalid-mode");
}
export function publicSummary(route) {
  const allowed = [
    "disabled",
    "shadow",
    "forced-hosted",
    "rerun",
    "warm-unenrolled",
    "activation-unverified",
    "invalid-mode",
  ];
  const reason = allowed.includes(route?.reason) ? route.reason : "activation-unverified";
  return `Blacksmith fallback: ${HOSTED}; ${reason}. Provider dispatch is disabled pending verified activation gates. Default-off and warm jobs retain existing owner routing.\n`;
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const route = hostedRoute({
    mode: process.env.TN_BLACKSMITH_MODE,
    forceHosted: process.env.TN_BLACKSMITH_FORCE_HOSTED,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    selection: process.env.TN_CI_SELECTION,
  });
  process.stdout.write(`blacksmith_runner=${HOSTED}\nblacksmith_reason=${route.reason}\n`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, publicSummary(route));
}
