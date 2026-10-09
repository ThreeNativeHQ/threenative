/**
 * three's PropertyBinding statics and console hook on the Wasm engine (PRD-540). The engine binds
 * the class (its bind() answers why a path did not bind, empty when it did); this hands that reason
 * to three's console function, as three's bind() warns through it, and adds parseTrackName (the
 * engine's parser, read back from a throwaway binding) and findNode. core's clip audit binds every
 * track this way before a model's clips play.
 */

type ConsoleFunction = (type: string, message: string, ...params: unknown[]) => void;

interface INativeBinding {
  bind(): string;
  readonly parsedPath: string;
}

interface INamedObject {
  readonly name: string;
  getObjectByName(name: string): object | undefined;
}

interface IParsedPath {
  nodeName?: string;
  objectName?: string;
  objectIndex?: string;
  propertyName: string;
  propertyIndex?: string;
}

export function definePropertyBinding(
  Native: new (root: object, path: string) => INativeBinding,
  Object3D: new () => object,
): {
  getConsoleFunction(): ConsoleFunction | null;
  setConsoleFunction(hook: ConsoleFunction | null | undefined): void;
} {
  let hook: ConsoleFunction | null = null;
  const nativeBind = Native.prototype.bind;
  Object.defineProperty(Native.prototype, "bind", {
    configurable: true,
    writable: true,
    value(this: INativeBinding): void {
      const reason = nativeBind.call(this);
      if (reason === "") return;
      if (hook !== null) hook("error", `THREE.PropertyBinding: ${reason}`);
      else console.error(`THREE.PropertyBinding: ${reason}`);
    },
  });
  Object.assign(Native, {
    parseTrackName(trackName: string): IParsedPath {
      const parsed = JSON.parse(new Native(new Object3D(), trackName).parsedPath) as
        | { error: string }
        | Record<string, string | null>;
      if ("error" in parsed && typeof parsed.error === "string") throw new Error(parsed.error);
      const record: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(parsed)) record[key] = value ?? undefined;
      return record as unknown as IParsedPath;
    },
    findNode(root: INamedObject, nodeName: string | number | undefined): object | null {
      if (nodeName === undefined || nodeName === "" || nodeName === "." || nodeName === -1)
        return root;
      if (nodeName === root.name) return root;
      return root.getObjectByName(String(nodeName)) ?? null;
    },
  });
  return {
    getConsoleFunction: () => hook,
    setConsoleFunction: (next) => {
      hook = next ?? null;
    },
  };
}
