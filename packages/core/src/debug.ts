/**
 * A debug switch a game reads the same way on every platform it ships to.
 *
 * Two questions an agent answers differently in every game, both of which cost a rewrite: how do I
 * turn this on for one run without changing the code, and how does a capture script reach the object
 * it wants to look at. The answers here are one function each, and neither decides how anything
 * looks.
 */

/** The shared global the engine's dev surfaces and `exposeDebug` both publish under. */
const HOST_KEY = "__THREENATIVE__";

/** `freeCam` → `FREE_CAM`. A name a developer typed becomes a name a shell can set. */
function envName(name: string): string {
  return `TN_DEBUG_${name.replace(/([a-z0-9])([A-Z])/gu, "$1_$2").toUpperCase()}`;
}

/**
 * `process.env` on a host that installed one, narrowed rather than asserted exactly as
 * `isDevLaunch` does in `game.ts`: it exists on the native runtime and not in a browser bundle.
 */
function envValue(name: string): string | undefined {
  const scope: unknown = globalThis;
  if (typeof scope !== "object" || scope === null || !("process" in scope)) return undefined;
  const hostProcess: unknown = scope.process;
  if (typeof hostProcess !== "object" || hostProcess === null || !("env" in hostProcess))
    return undefined;
  const env: unknown = hostProcess.env;
  if (typeof env !== "object" || env === null) return undefined;
  const value: unknown = (env as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

/** Not one of the two spellings of off. */
function isOn(value: string): boolean {
  return value !== "0" && value !== "false";
}

/**
 * A debug switch read from the URL, or from the environment on a native launch.
 *
 * @situation read a debug toggle from the URL or an environment variable
 *
 * A browser asks with the query string — `?freeCam`, or `?freeCam=0` to force it off — and a native
 * launch asks with `TN_DEBUG_FREE_CAM`, because a query string is not something a developer sets on
 * a command line. `0` and `false` are off, so a saved URL that used to enable a switch still says
 * "off" rather than quietly turning it back on.
 */
export function debugFlag(name: string): boolean {
  // An exported-but-empty variable is off, as `DEV_MODE=` is to the engine's own reader; a bare
  // `?freeCam` is on, because the query string has no other way to say it.
  const env = envValue(envName(name));
  if (env !== undefined && env !== "" && isOn(env)) return true;
  const search: unknown = globalThis.location?.search;
  if (typeof search !== "string") return false;
  const value = new URLSearchParams(search).get(name);
  return value !== null && isOn(value);
}

/**
 * Publish one game object for a capture script or the console, in development builds only.
 *
 * @situation expose a game object to a capture script or the console in dev builds
 *
 * Playtest reads `__THREENATIVE__` in a dev build and is silent in a production one, so a game that
 * publishes its player, its camera or a scene handle under `.debug` is reachable from the same
 * place a production build is not. Other keys on the shared object are left alone; the dev surfaces
 * the engine installs beside them keep working.
 */
export function exposeDebug(name: string, value: unknown): void {
  // Written out here rather than through a helper: the bundler must see the literal `import.meta`
  // access to strip the whole publish from a production build, and an indirection survives into the
  // bundle — where the game is compiled as a script, not a module, and the bundle fails to parse.
  const isDev =
    (import.meta as ImportMeta & { env?: Record<"DEV", boolean | undefined> }).env?.DEV === true;
  if (!isDev) return;
  const tools = (Reflect.get(globalThis, HOST_KEY) ?? {}) as { debug?: Record<string, unknown> };
  const debug = tools.debug ?? {};
  debug[name] = value;
  tools.debug = debug;
  Reflect.set(globalThis, HOST_KEY, tools);
}
