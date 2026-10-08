/**
 * Configuration dimensions and their fixed resolutions, per
 * `docs/architecture/NATIVE-ENGINE-DECISION.md` section 6 and PRD-530 Solution 1.
 *
 * A contradictory profile is rejected at packaging time with a named code rather than tolerated
 * at runtime, and a rejected profile never falls back to another artifact.
 */

export type ThreeNativeEngine = "legacy" | "native";
export type ThreeNativeGameRuntime = "js" | "native-aot" | "cpp";
export type ThreeNativeProfileUi = "webview" | "native" | "none";
export type ThreeNativeArtifactKind = "legacy" | "native-engine" | "strict-native";

export interface INativeProfileInput {
  readonly engine: ThreeNativeEngine;
  readonly gameRuntime: ThreeNativeGameRuntime;
  readonly ui: ThreeNativeProfileUi;
  /** The artifact dynamically loads a JS runtime component. */
  readonly loadsJsRuntime: boolean;
  /** Requested artifact kind; `true` asks for a strict, JS-free artifact. */
  readonly strict?: boolean;
}

export interface INativeProfile {
  readonly artifact: ThreeNativeArtifactKind;
  readonly jsFree: boolean;
  /** Present only when a non-JS-free artifact carries its own browser runtime. */
  readonly label?: string;
}

const ENGINES: readonly ThreeNativeEngine[] = ["legacy", "native"];
const GAME_RUNTIMES: readonly ThreeNativeGameRuntime[] = ["js", "native-aot", "cpp"];
const PROFILE_UIS: readonly ThreeNativeProfileUi[] = ["webview", "native", "none"];

function fail(code: string, reason: string): never {
  throw new Error(`${code}: ${reason}`);
}

function describe(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : String(value);
}

function assertKnown<T extends string>(field: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(
      "TN_PROFILE_UNKNOWN",
      `${field} has unknown value ${describe(value)}; expected one of ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}

function assertBoolean(field: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    fail("TN_PROFILE_UNKNOWN", `${field} must be a boolean, received ${describe(value)}.`);
  }
  return value;
}

/**
 * Rejection order is deliberate. The enum check runs first so no unknown value is judged against a
 * rule table it is not part of. `TN_PROFILE_STRICT_LEGACY` then runs before the strict runtime and
 * UI checks, because the legacy host only ever runs JavaScript: checking the legacy engine first is
 * the only order in which all three strict codes are reachable.
 */
export function resolveNativeProfile(input: INativeProfileInput): INativeProfile {
  if (typeof input !== "object" || input === null) {
    fail("TN_PROFILE_UNKNOWN", `profile input must be an object, received ${describe(input)}.`);
  }
  const raw = input;
  const engine = assertKnown("engine", raw.engine, ENGINES);
  const gameRuntime = assertKnown("gameRuntime", raw.gameRuntime, GAME_RUNTIMES);
  const ui = assertKnown("ui", raw.ui, PROFILE_UIS);
  const loadsJsRuntime = assertBoolean("loadsJsRuntime", raw.loadsJsRuntime);
  const strict = raw.strict === undefined ? false : assertBoolean("strict", raw.strict);

  if (engine === "legacy" && gameRuntime !== "js") {
    fail(
      "TN_PROFILE_LEGACY_NATIVE_RUNTIME",
      `engine 'legacy' cannot run game runtime '${gameRuntime}' because the legacy host only runs JavaScript.`,
    );
  }
  if (strict && engine === "legacy") {
    fail(
      "TN_PROFILE_STRICT_LEGACY",
      "strict was requested with engine 'legacy', and a strict artifact needs the native engine.",
    );
  }
  if (gameRuntime !== "js" && loadsJsRuntime) {
    fail(
      "TN_PROFILE_NATIVE_LOADS_JS",
      `game runtime '${gameRuntime}' with loadsJsRuntime true is not a strict artifact.`,
    );
  }
  if (strict && gameRuntime === "js") {
    fail(
      "TN_PROFILE_STRICT_JS_RUNTIME",
      "strict was requested with game runtime 'js', and a strict artifact needs native-aot or cpp.",
    );
  }
  if (strict && ui === "webview") {
    fail(
      "TN_PROFILE_STRICT_WEBVIEW",
      "strict was requested with UI 'webview', and a strict artifact uses native or no UI.",
    );
  }

  if (engine === "legacy") return { artifact: "legacy", jsFree: false };
  if (gameRuntime === "js") return { artifact: "native-engine", jsFree: false };
  if (ui === "webview") {
    return {
      artifact: "native-engine",
      jsFree: false,
      label: "Carries a WebView and is never called JS-free.",
    };
  }
  return { artifact: "strict-native", jsFree: true };
}
