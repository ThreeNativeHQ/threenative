import { describe, expect, it } from "vitest";
import {
  type INativeProfileInput,
  type ThreeNativeArtifactKind,
  type ThreeNativeEngine,
  type ThreeNativeGameRuntime,
  type ThreeNativeProfileUi,
  resolveNativeProfile,
} from "../src/native-profile.js";

const ENGINES: readonly ThreeNativeEngine[] = ["legacy", "native"];
const GAME_RUNTIMES: readonly ThreeNativeGameRuntime[] = ["js", "native-aot", "cpp"];
const PROFILE_UIS: readonly ThreeNativeProfileUi[] = ["webview", "native", "none"];
const LOADS_JS_RUNTIME: readonly boolean[] = [false, true];
const STRICT: readonly (boolean | undefined)[] = [false, true];

type Expected =
  | { readonly error: string }
  | {
      readonly artifact: ThreeNativeArtifactKind;
      readonly jsFree: boolean;
      readonly label: boolean;
    };

/**
 * The rule table from `docs/architecture/NATIVE-ENGINE-DECISION.md` section 6 and PRD-530
 * Solution 1, written here independently of the implementation so a matching bug in both cannot
 * hide. Any rejected profile throws; none falls back to another artifact.
 */
function expected(
  engine: ThreeNativeEngine,
  gameRuntime: ThreeNativeGameRuntime,
  ui: ThreeNativeProfileUi,
  loadsJsRuntime: boolean,
  strict: boolean | undefined,
): Expected {
  if (engine === "legacy" && gameRuntime !== "js") {
    return { error: "TN_PROFILE_LEGACY_NATIVE_RUNTIME" };
  }
  if (strict === true && engine === "legacy") {
    return { error: "TN_PROFILE_STRICT_LEGACY" };
  }
  if (gameRuntime !== "js" && loadsJsRuntime) {
    return { error: "TN_PROFILE_NATIVE_LOADS_JS" };
  }
  if (strict === true && gameRuntime === "js") {
    return { error: "TN_PROFILE_STRICT_JS_RUNTIME" };
  }
  if (strict === true && ui === "webview") {
    return { error: "TN_PROFILE_STRICT_WEBVIEW" };
  }
  if (engine === "legacy") return { artifact: "legacy", jsFree: false, label: false };
  if (gameRuntime === "js") return { artifact: "native-engine", jsFree: false, label: false };
  if (ui === "webview") return { artifact: "native-engine", jsFree: false, label: true };
  return { artifact: "strict-native", jsFree: true, label: false };
}

function context(
  engine: ThreeNativeEngine,
  gameRuntime: ThreeNativeGameRuntime,
  ui: ThreeNativeProfileUi,
  loadsJsRuntime: boolean,
  strict: boolean | undefined,
): string {
  return `engine=${engine} gameRuntime=${gameRuntime} ui=${ui} loadsJsRuntime=${String(loadsJsRuntime)} strict=${String(strict)}`;
}

describe("resolveNativeProfile", () => {
  it("resolves or rejects all 72 engine/runtime/UI/loadsJsRuntime/strict combinations", () => {
    const cases: readonly INativeProfileInput[] = ENGINES.flatMap((engine) =>
      GAME_RUNTIMES.flatMap((gameRuntime) =>
        PROFILE_UIS.flatMap((ui) =>
          LOADS_JS_RUNTIME.flatMap((loadsJsRuntime) =>
            STRICT.map((strict) => ({ engine, gameRuntime, ui, loadsJsRuntime, strict })),
          ),
        ),
      ),
    );

    expect(cases).toHaveLength(72);

    for (const input of cases) {
      const label = context(
        input.engine,
        input.gameRuntime,
        input.ui,
        input.loadsJsRuntime,
        input.strict,
      );
      const want = expected(
        input.engine,
        input.gameRuntime,
        input.ui,
        input.loadsJsRuntime,
        input.strict,
      );
      if ("error" in want) {
        expect(() => resolveNativeProfile(input), label).toThrowError(
          new RegExp(`^${want.error}: `),
        );
        continue;
      }
      const resolved = resolveNativeProfile(input);
      expect(resolved.artifact, label).toBe(want.artifact);
      expect(resolved.jsFree, label).toBe(want.jsFree);
      if (want.label) expect(resolved.label, label).toBeDefined();
      else expect(resolved.label, label).toBeUndefined();
    }
  });

  it("names the offending values in every rejection", () => {
    const errors: readonly (readonly [INativeProfileInput, string, readonly string[]])[] = [
      [
        { engine: "legacy", gameRuntime: "native-aot", ui: "native", loadsJsRuntime: false },
        "TN_PROFILE_LEGACY_NATIVE_RUNTIME",
        ["'legacy'", "'native-aot'"],
      ],
      [
        { engine: "native", gameRuntime: "cpp", ui: "native", loadsJsRuntime: true },
        "TN_PROFILE_NATIVE_LOADS_JS",
        ["'cpp'", "true"],
      ],
      [
        { engine: "native", gameRuntime: "js", ui: "webview", loadsJsRuntime: false, strict: true },
        "TN_PROFILE_STRICT_JS_RUNTIME",
        ["'js'"],
      ],
      [
        {
          engine: "native",
          gameRuntime: "native-aot",
          ui: "webview",
          loadsJsRuntime: false,
          strict: true,
        },
        "TN_PROFILE_STRICT_WEBVIEW",
        ["'webview'"],
      ],
      [
        { engine: "legacy", gameRuntime: "js", ui: "none", loadsJsRuntime: false, strict: true },
        "TN_PROFILE_STRICT_LEGACY",
        ["'legacy'"],
      ],
    ];

    for (const [input, code, values] of errors) {
      const message = (() => {
        try {
          resolveNativeProfile(input);
        } catch (error) {
          return (error as Error).message;
        }
        return "";
      })();
      expect(
        message.startsWith(`${code}: `),
        context(input.engine, input.gameRuntime, input.ui, input.loadsJsRuntime, input.strict),
      ).toBe(true);
      for (const value of values) expect(message).toContain(value);
    }
  });

  it("treats an omitted strict request as the non-strict resolution", () => {
    expect(
      resolveNativeProfile({
        engine: "native",
        gameRuntime: "native-aot",
        ui: "native",
        loadsJsRuntime: false,
      }),
    ).toEqual({ artifact: "strict-native", jsFree: true });
  });

  it("fails closed on an unknown value in any field", () => {
    const base = {
      engine: "native",
      gameRuntime: "js",
      ui: "native",
      loadsJsRuntime: false,
    } as const;

    const unknown = (overrides: Record<string, unknown>): void => {
      expect(
        () => resolveNativeProfile({ ...base, ...overrides } as unknown as INativeProfileInput),
        JSON.stringify(overrides),
      ).toThrowError(/^TN_PROFILE_UNKNOWN: /);
    };

    unknown({ engine: "electron" });
    unknown({ gameRuntime: "wasm" });
    unknown({ ui: "dom" });
    unknown({ loadsJsRuntime: "yes" });
    unknown({ strict: "yes" });
    unknown({ engine: "bogus", gameRuntime: "cpp", loadsJsRuntime: true });
    unknown({ gameRuntime: "electron" });

    expect(() => resolveNativeProfile(null as unknown as INativeProfileInput)).toThrowError(
      /^TN_PROFILE_UNKNOWN: /,
    );
  });
});
