/**
 * A debug switch a game reads the same way on every platform it ships to.
 *
 * Two questions an agent answers differently in every game, both of which cost a rewrite: how do I
 * turn this on for one run without changing the code, and how does a capture script reach the object
 * it wants to look at. The answers here are one function each, and neither decides how anything
 * looks.
 */

/** The shared global the engine's dev surfaces and `exposeDebug` both publish under. */
interface IDebugHost {
  // biome-ignore lint/style/useNamingConvention: the global's published name, in every tool that reads it.
  __THREENATIVE__?: { debug?: Record<string, unknown> } & Record<string, unknown>;
}

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

/** Asked for and not one of the two spellings of off. A bare `?freeCam` is asked for. */
function isOn(value: string | null | undefined): boolean {
  return value !== undefined && value !== null && value !== "0" && value !== "false";
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
  if (isOn(envValue(envName(name)))) return true;
  const search: unknown = globalThis.location?.search;
  if (typeof search !== "string") return false;
  return isOn(new URLSearchParams(search).get(name));
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
  // quality-allow: DEV is the bundler's own name for the flag, so the name rule cannot apply.
  // Written out here rather than through a helper: the bundler must see the literal `import.meta`
  // access to strip the whole publish from a production build, and an indirection survives into the
  // bundle — where the game is compiled as a script, not a module, and the bundle fails to parse.
  const isDev =
    (import.meta as ImportMeta & { env?: Record<"DEV", boolean | undefined> }).env?.DEV === true;
  if (!isDev) return;
  const host = globalThis as unknown as IDebugHost;
  const tools = host.__THREENATIVE__ ?? {};
  const debug = tools.debug ?? {};
  debug[name] = value;
  tools.debug = debug;
  host.__THREENATIVE__ = tools;
}
