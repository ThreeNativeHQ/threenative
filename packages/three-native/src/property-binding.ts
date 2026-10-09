/**
 * three's PropertyBinding and console function over the engine's PropertyBinding, for both back ends
 * (the V8 player and the Wasm engine). The engine binds; this keeps three's JS surface: the static
 * `parseTrackName` and `findNode`, `targetObject` as a property, and a failed bind reported through
 * `setConsoleFunction`'s function (three's utils `error()`), or `console.error` without one.
 */

type ConsoleFunction = (type: string, message: string, ...params: unknown[]) => void;

interface IEngineBinding {
  bind(): string;
  targetObject(): unknown;
  parseTrackName(path: string): Record<string, string | undefined>;
  findNode(root: unknown, nodeName?: string): unknown;
}

type EngineClass = (new (...args: unknown[]) => object) & Record<string, unknown>;

export function definePropertyBinding(Native: EngineClass) {
  let consoleFunction: ConsoleFunction | null = null;
  const prototype = Native.prototype as IEngineBinding;
  const bind = prototype.bind;
  const target = prototype.targetObject;
  // One engine object with no root answers the statics.
  let helper: IEngineBinding | undefined;
  const statics = (): IEngineBinding => {
    helper ??= new Native() as unknown as IEngineBinding;
    return helper;
  };

  Object.defineProperties(prototype, {
    bind: {
      configurable: true,
      writable: true,
      value(this: IEngineBinding): void {
        const reason = bind.call(this);
        if (reason === "") return;
        if (consoleFunction !== null) consoleFunction("error", reason);
        else console.error(reason);
      },
    },
    targetObject: {
      configurable: true,
      get(this: IEngineBinding): unknown {
        return target.call(this);
      },
    },
  });
  Object.assign(Native, {
    parseTrackName: (path: string) => statics().parseTrackName(path),
    findNode: (root: unknown, nodeName?: string) => statics().findNode(root, nodeName),
  });

  const PropertyBinding = Native;
  return {
    PropertyBinding,
    getConsoleFunction: (): ConsoleFunction | null => consoleFunction,
    setConsoleFunction: (fn: ConsoleFunction | null | undefined): void => {
      consoleFunction = fn ?? null;
    },
  };
}
