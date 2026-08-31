// Which arm this build draws. One build, one selector, three arms — `virtual` arrives with
// PRD-283 and is named here so the harness is built for it rather than retrofitted around it.

export const QUARRY_ARMS = ["dense", "decimated", "virtual"] as const;

export type QuarryArm = (typeof QUARRY_ARMS)[number];

export const DEFAULT_ARM: QuarryArm = "dense";

/** The `.glb` each arm draws its bodies from. The floor is shared and is not listed here. */
export function bodiesModelPath(arm: QuarryArm): string {
  switch (arm) {
    case "dense":
      return "assets/quarry-bodies-dense.glb";
    case "decimated":
      return "assets/quarry-bodies-decimated.glb";
    case "virtual":
      return "assets/quarry-bodies-virtual.glb";
  }
}

export function parseArm(value: string | null | undefined): QuarryArm {
  if (value === undefined || value === null || value === "") return DEFAULT_ARM;
  const found = QUARRY_ARMS.find((arm) => arm === value);
  // Fails closed: a misspelled arm would otherwise silently measure the default one and be
  // reported as the arm that was asked for, which is the one mistake this instrument cannot make.
  if (found === undefined)
    throw new Error(`TN_QUARRY_UNKNOWN_ARM: '${value}' is not one of ${QUARRY_ARMS.join(", ")}.`);
  return found;
}

/** The arm named in `?arm=` on the web, or the default. Native entries pass their arm directly. */
export function armFromLocation(): QuarryArm {
  const search = globalThis.location?.search;
  if (typeof search !== "string") return DEFAULT_ARM;
  return parseArm(new URLSearchParams(search).get("arm"));
}

export const QUARRY_MODES = ["control", "free", "route"] as const;

export type QuarryMode = (typeof QUARRY_MODES)[number];

/**
 * `?mode=free` hands the walk to a person, `?mode=control` parks the camera over the pit floor so
 * the control surface can be diffed between arms, and anything else drives the fixed route.
 */
export function modeFromLocation(): QuarryMode {
  const search = globalThis.location?.search;
  if (typeof search !== "string") return "route";
  const value = new URLSearchParams(search).get("mode");
  if (value === undefined || value === null || value === "") return "route";
  const found = QUARRY_MODES.find((mode) => mode === value);
  // Fails closed for the same reason the arm does: a misspelled mode would silently walk the route
  // and be reported as whichever mode was asked for.
  if (found === undefined)
    throw new Error(`TN_QUARRY_UNKNOWN_MODE: '${value}' is not one of ${QUARRY_MODES.join(", ")}.`);
  return found;
}
