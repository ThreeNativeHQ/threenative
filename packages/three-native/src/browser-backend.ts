/**
 * The browser-JS back end (PRD-532): three's class names as JS classes over the engine's C ABI
 * compiled to Wasm.
 *
 * The classes are built from the binding registry snapshot (`api/native-registry.json`): every class
 * the registry binds becomes a constructor whose prototype carries exactly that class's methods,
 * top-level getters and setters, and member objects. That is the surface the catalog marks supported
 * (`catalog-registry.spec.ts`), and nothing else. Dotted registry paths (`position.x`) are protocol
 * paths and stay off the prototype: `mesh.position.x` goes through the member object.
 *
 * One wrapper per engine handle, so identity survives (`mesh.position === mesh.position`); a
 * collected wrapper releases its object.
 */

export interface IRegistryClass {
  readonly constructor: boolean;
  readonly methods: readonly string[];
  readonly getters: readonly string[];
  readonly setters: readonly string[];
  readonly members: readonly string[];
  /** Language callbacks the engine calls back (`onBeforeRender`). */
  readonly callbacks: readonly string[];
}

export interface IRegistryDump {
  readonly classes: Readonly<Record<string, IRegistryClass>>;
}

/** An engine object as the back end sees it: an opaque key and its catalog type id. */
export interface IEngineRef {
  readonly key: string;
  readonly type: number;
}

export type EngineValue =
  | null
  | undefined
  | number
  | boolean
  | string
  | readonly EngineValue[]
  | IEngineRef
  | { readonly [key: string]: EngineValue };

/** What the classes call; the Wasm ABI implements it, and a surface-only runtime refuses every call. */
export interface IBrowserRuntime {
  typeId(className: string): number;
  construct(className: string, args: readonly EngineValue[]): IEngineRef;
  invoke(self: IEngineRef, method: string, args: readonly EngineValue[]): EngineValue;
  get(self: IEngineRef, path: string): EngineValue;
  set(self: IEngineRef, path: string, value: EngineValue): void;
  release(self: IEngineRef): void;
  /** Sets (or, with null, clears) a callback the engine runs; `handler` gets the engine's arguments. */
  setCallback(
    self: IEngineRef,
    name: string,
    handler: ((args: readonly EngineValue[]) => void) | null,
  ): void;
}

/** The defined classes and the callback safe point the host runs between frames. */
export interface IBrowserEngine {
  readonly classes: Record<string, new (...args: unknown[]) => object>;
  /**
   * A wrapper whose object carries a callback is held while the object is attached (the engine may
   * call it) and let go once detached, so a detached object, its closure and the wrapper the closure
   * captured are a cycle the collector reclaims.
   */
  collect(): void;
}

const REF = Symbol("tn.engineRef");

interface IWrapped {
  [REF]: IEngineRef;
}

/** The engine object behind a back-end wrapper, for a host that talks to the ABI directly. */
export function engineRef(object: object): IEngineRef | undefined {
  return (object as Partial<IWrapped>)[REF];
}

function isRef(value: unknown): value is IEngineRef {
  return typeof value === "object" && value !== null && "key" in value && "type" in value;
}

/** Defines every registry class over `runtime`. */
export function defineBrowserClasses(
  registry: IRegistryDump,
  runtime: IBrowserRuntime,
): IBrowserEngine {
  const classes: Record<string, new (...args: unknown[]) => object> = {};
  const byType = new Map<number, { prototype: object }>();
  const wrappers = new Map<string, WeakRef<object>>();
  // Callbacks: the function lives on its wrapper (a WeakMap entry), so wrapper -> closure is an edge
  // the collector sees; `held` roots a wrapper while the engine may still call it.
  const callbackFunctions = new WeakMap<object, Map<string, (...args: unknown[]) => unknown>>();
  const callbackNames = new Map<string, Set<string>>(); // by handle key, to clear on collection
  const held = new Set<object>();
  const released = new FinalizationRegistry<IEngineRef>((ref) => {
    if (wrappers.get(ref.key)?.deref() === undefined) {
      wrappers.delete(ref.key);
      for (const name of callbackNames.get(ref.key) ?? []) runtime.setCallback(ref, name, null);
      callbackNames.delete(ref.key);
      runtime.release(ref);
    }
  });

  const adopt = (target: object, ref: IEngineRef): object => {
    (target as IWrapped)[REF] = ref;
    wrappers.set(ref.key, new WeakRef(target));
    released.register(target, ref);
    return target;
  };
  const wrap = (ref: IEngineRef): object => {
    const live = wrappers.get(ref.key)?.deref();
    if (live !== undefined) return live;
    const cls = byType.get(ref.type);
    if (cls === undefined)
      throw new TypeError(`TN_BROWSER_TYPE_UNKNOWN: no class for engine type ${ref.type}`);
    return adopt(Object.create(cls.prototype) as object, ref);
  };
  const refOf = (self: unknown): IEngineRef => {
    const ref = (self as Partial<IWrapped> | null)?.[REF];
    if (ref === undefined)
      throw new TypeError(
        "TN_BROWSER_NOT_ENGINE_OBJECT: called on an object the engine does not own",
      );
    return ref;
  };
  const toEngine = (value: unknown): EngineValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string")
      return value;
    if (Array.isArray(value) || ArrayBuffer.isView(value))
      return Array.from(value as ArrayLike<unknown>, toEngine);
    if (typeof value === "object" && REF in value) {
      // An object with callbacks passed into the engine is held until the next safe point.
      if (callbackNames.has((value as IWrapped)[REF].key)) held.add(value);
      return (value as IWrapped)[REF];
    }
    throw new TypeError(
      `TN_BROWSER_ARGUMENT_UNSUPPORTED: ${typeof value} cannot cross to the engine`,
    );
  };
  const fromEngine = (value: EngineValue): unknown => {
    if (isRef(value)) return wrap(value);
    if (Array.isArray(value)) return value.map(fromEngine);
    if (typeof value === "object" && value !== null)
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, fromEngine(item)]),
      );
    return value;
  };

  for (const [name, binding] of Object.entries(registry.classes)) {
    const cls = function (this: object, ...args: unknown[]) {
      if (!new.target)
        throw new TypeError(`Class constructor ${name} cannot be invoked without 'new'`);
      if (!binding.constructor) throw new TypeError(`TN_BROWSER_NOT_CONSTRUCTIBLE: ${name}`);
      return adopt(this, runtime.construct(name, args.map(toEngine)));
    } as unknown as new (
      ...args: unknown[]
    ) => object;
    Object.defineProperty(cls, "name", { value: name });
    const prototype = cls.prototype as Record<string, unknown>;
    for (const method of binding.methods) {
      Object.defineProperty(prototype, method, {
        configurable: true,
        writable: true,
        value(this: object, ...args: unknown[]) {
          const intersections = method === "intersectObject" || method === "intersectObjects";
          const result = fromEngine(
            runtime.invoke(
              refOf(this),
              method,
              (intersections ? args.slice(0, 2) : args).map(toEngine),
            ),
          );
          if (intersections && args[2] !== undefined) {
            if (!Array.isArray(args[2]) || !Array.isArray(result))
              throw new TypeError("intersection target must be an array");
            args[2].push(...result);
            args[2].sort((a, b) => a.distance - b.distance);
            return args[2];
          }
          return result;
        },
      });
    }
    const setters = new Set(binding.setters);
    for (const property of [...binding.getters, ...binding.members]) {
      if (property.includes(".") || binding.methods.includes(property)) continue;
      Object.defineProperty(prototype, property, {
        configurable: true,
        get(this: object) {
          return fromEngine(runtime.get(refOf(this), property));
        },
        ...(setters.has(property)
          ? {
              set(this: object, value: unknown) {
                runtime.set(refOf(this), property, toEngine(value));
              },
            }
          : {}),
      });
    }
    for (const callback of binding.callbacks) {
      Object.defineProperty(prototype, callback, {
        configurable: true,
        get(this: object) {
          return callbackFunctions.get(this)?.get(callback) ?? null;
        },
        set(this: object, fn: unknown) {
          const ref = refOf(this);
          const functions = callbackFunctions.get(this) ?? new Map();
          if (fn === null || fn === undefined) {
            runtime.setCallback(ref, callback, null);
            functions.delete(callback);
            callbackNames.get(ref.key)?.delete(callback);
            return;
          }
          if (typeof fn !== "function")
            throw new TypeError(`${callback} must be a function or null`);
          const self = new WeakRef(this);
          runtime.setCallback(ref, callback, (args) => {
            const target = self.deref();
            const current =
              target === undefined ? undefined : callbackFunctions.get(target)?.get(callback);
            current?.apply(target, args.map(fromEngine));
          });
          functions.set(callback, fn as (...args: unknown[]) => unknown);
          callbackFunctions.set(this, functions);
          callbackNames.set(ref.key, (callbackNames.get(ref.key) ?? new Set()).add(callback));
          held.add(this);
        },
      });
    }
    classes[name] = cls;
    byType.set(runtime.typeId(name), cls as unknown as { prototype: object });
  }
  return {
    classes,
    collect() {
      for (const [key, names] of callbackNames) {
        const wrapper = wrappers.get(key)?.deref();
        if (wrapper === undefined || names.size === 0) continue;
        if (runtime.get(refOf(wrapper), "parent") !== null) held.add(wrapper);
        else held.delete(wrapper);
      }
    },
  };
}

/**
 * The engine's C ABI as built by `tn-native-engine-abi-module` (Emscripten, wasm32). The names are
 * Emscripten's (`HEAPU8`, `_malloc`, `_tn_*`), so they are declared as record keys.
 */
type AbiCall =
  | "_malloc"
  | "_free"
  | "_tn_engine_version"
  | "_tn_context_create"
  | "_tn_type_id"
  | "_tn_object_release"
  | "_tn_construct"
  | "_tn_invoke"
  | "_tn_get"
  | "_tn_set"
  | "_tn_set_callback"
  | "_tn_diagnostic_release";
export type TnAbiModule = Record<AbiCall, (...args: number[]) => number> &
  Record<"HEAPU8", Uint8Array> &
  Record<"HEAPF64", Float64Array> &
  Record<"UTF8ToString", (pointer: number, maxBytes?: number) => string> &
  Record<
    "addFunction",
    (fn: (...args: number[]) => number | undefined, signature: string) => number
  > & {
    stringToUTF8(text: string, pointer: number, maxBytes: number): void;
    lengthBytesUTF8(text: string): number;
  };

// wasm32 layouts of tn_abi.h, measured with offsetof under emcc: tn_handle_t 12 bytes; tn_value_t
// 56 bytes (kind 0, boolean 4, number 8, handle 16, text 32, count 40, numbers 48); tn_diagnostic_t
// 8 bytes (message 0, code 4); tn_version_info_t 32 bytes. A struct passed by value goes by pointer.
const HANDLE = 12;
const VALUE = 56;
const KIND = {
  null: 0,
  number: 1,
  bool: 2,
  string: 3,
  handle: 4,
  numbers: 5,
  array: 6,
  record: 7,
  undefined: 8,
} as const;

/** The runtime over a loaded ABI module: one engine context, every call checked. */
export function createWasmRuntime(abi: TnAbiModule): IBrowserRuntime {
  const view = () => new DataView(abi.HEAPU8.buffer);
  // Each call frees what it allocated, and only that: a callback can run a nested call.
  const allocations: number[] = [];
  const alloc = (size: number): number => {
    const pointer = abi._malloc(size);
    abi.HEAPU8.fill(0, pointer, pointer + size);
    allocations.push(pointer);
    return pointer;
  };
  const scoped = <T>(work: () => T): T => {
    const mark = allocations.length;
    try {
      return work();
    } finally {
      for (const pointer of allocations.splice(mark)) abi._free(pointer);
    }
  };
  const string = (text: string): { pointer: number; bytes: number } => {
    const bytes = abi.lengthBytesUTF8(text);
    const pointer = alloc(bytes + 1);
    abi.stringToUTF8(text, pointer, bytes + 1);
    return { pointer, bytes };
  };
  const diagnostic = () => alloc(8);
  const check = (status: number, diag: number, what: string) => {
    if (status === 0) return;
    const message = view().getUint32(diag, true);
    const text = message === 0 ? "" : abi.UTF8ToString(message);
    abi._tn_diagnostic_release(diag);
    throw new Error(`TN_ABI_${status}: ${what}${text ? `: ${text}` : ""}`);
  };
  const keyOf = (pointer: number): IEngineRef => {
    const v = view();
    const type = v.getUint16(pointer, true);
    const key = `${type}:${v.getUint16(pointer + 2, true)}:${v.getUint32(pointer + 4, true)}:${v.getUint32(pointer + 8, true)}`;
    return { key, type };
  };
  const writeHandle = (pointer: number, ref: IEngineRef) => {
    const [type, context, index, generation] = ref.key.split(":").map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const v = view();
    v.setUint16(pointer, type, true);
    v.setUint16(pointer + 2, context, true);
    v.setUint32(pointer + 4, index, true);
    v.setUint32(pointer + 8, generation, true);
  };
  const handleOf = (ref: IEngineRef): number => {
    const pointer = alloc(HANDLE);
    writeHandle(pointer, ref);
    return pointer;
  };
  const writeValue = (pointer: number, value: EngineValue) => {
    const v = view();
    if (value === null) return v.setUint32(pointer, KIND.null, true);
    if (value === undefined) return v.setUint32(pointer, KIND.undefined, true);
    if (typeof value === "number") {
      v.setUint32(pointer, KIND.number, true);
      return v.setFloat64(pointer + 8, value, true);
    }
    if (typeof value === "boolean") {
      v.setUint32(pointer, KIND.bool, true);
      return v.setUint32(pointer + 4, value ? 1 : 0, true);
    }
    if (typeof value === "string") {
      const text = string(value);
      const w = view();
      w.setUint32(pointer, KIND.string, true);
      w.setUint32(pointer + 32, text.pointer, true);
      return w.setBigUint64(pointer + 40, BigInt(text.bytes), true);
    }
    if (isRef(value)) {
      v.setUint32(pointer, KIND.handle, true);
      return writeHandle(pointer + 16, value);
    }
    if (!Array.isArray(value)) throw new TypeError("TN_ABI_VALUE: input record unsupported");
    if (value.every((item) => typeof item === "number")) {
      const numbers = alloc(Math.max(8, value.length * 8));
      abi.HEAPF64.set(value as number[], numbers / 8);
      const w = view();
      w.setUint32(pointer, KIND.numbers, true);
      w.setUint32(pointer + 48, numbers, true);
      w.setBigUint64(pointer + 40, BigInt(value.length), true);
    } else {
      const children = values(value);
      const w = view();
      w.setUint32(pointer, KIND.array, true);
      w.setUint32(pointer + 48, children, true);
      w.setBigUint64(pointer + 40, BigInt(value.length), true);
    }
  };
  const values = (args: readonly EngineValue[]): number => {
    const pointer = alloc(Math.max(VALUE, args.length * VALUE));
    args.forEach((arg, i) => writeValue(pointer + i * VALUE, arg));
    return pointer;
  };
  const readValue = (pointer: number): EngineValue => {
    const v = view();
    switch (v.getUint32(pointer, true)) {
      case KIND.undefined:
        return undefined;
      case KIND.number:
        return v.getFloat64(pointer + 8, true);
      case KIND.bool:
        return v.getUint32(pointer + 4, true) !== 0;
      case KIND.string:
        return abi.UTF8ToString(
          v.getUint32(pointer + 32, true),
          Number(v.getBigUint64(pointer + 40, true)),
        );
      case KIND.handle:
        return keyOf(pointer + 16);
      case KIND.array: {
        const at = v.getUint32(pointer + 48, true);
        return Array.from({ length: Number(v.getBigUint64(pointer + 40, true)) }, (_, i) =>
          readValue(at + i * VALUE),
        );
      }
      case KIND.record: {
        const at = v.getUint32(pointer + 48, true);
        return Object.fromEntries(
          Array.from({ length: Number(v.getBigUint64(pointer + 40, true)) }, (_, i) => {
            const key = readValue(at + i * 2 * VALUE);
            if (typeof key !== "string") throw new TypeError("TN_ABI_RECORD_KEY: expected string");
            return [key, readValue(at + (i * 2 + 1) * VALUE)];
          }),
        );
      }
      case KIND.numbers: {
        const at = v.getUint32(pointer + 48, true) / 8;
        return Array.from(
          abi.HEAPF64.subarray(at, at + Number(v.getBigUint64(pointer + 40, true))),
        );
      }
      default:
        return null;
    }
  };

  // Callbacks: one invoke and one release trampoline in the function table; the context is a
  // handler id, and the engine's release (once per pair) forgets it.
  const handlers = new Map<number, (args: readonly EngineValue[]) => void>();
  let nextHandler = 1;
  let invokeTrampoline = 0;
  let releaseTrampoline = 0;
  const trampolines = () => {
    if (invokeTrampoline !== 0) return;
    invokeTrampoline = abi.addFunction((id, args, count, error, capacity) => {
      const handler = handlers.get(id ?? 0);
      if (handler === undefined) return 0;
      const decoded: EngineValue[] = [];
      for (let i = 0; i < (count ?? 0); i++) decoded.push(readValue((args ?? 0) + i * VALUE));
      try {
        handler(decoded);
        return 0;
      } catch (thrown) {
        abi.stringToUTF8(
          thrown instanceof Error ? thrown.message : String(thrown),
          error ?? 0,
          capacity ?? 0,
        );
        return 8; // TN_ERROR_INVALID_STATE: the engine records it and goes on
      }
    }, "iiiiii");
    releaseTrampoline = abi.addFunction((id) => {
      handlers.delete(id ?? 0);
      return undefined;
    }, "vi");
  };

  const context = scoped(() => {
    const version = alloc(32);
    abi._tn_engine_version(version);
    const contextOut = alloc(4);
    const diag = diagnostic();
    check(abi._tn_context_create(contextOut, version, diag), diag, "tn_context_create");
    return view().getUint32(contextOut, true);
  });

  return {
    typeId: (className) => scoped(() => abi._tn_type_id(string(className).pointer)),
    construct: (className, args) =>
      scoped(() => {
        const out = alloc(HANDLE);
        const diag = diagnostic();
        check(
          abi._tn_construct(
            context,
            string(className).pointer,
            values(args),
            args.length,
            out,
            diag,
          ),
          diag,
          `new ${className}`,
        );
        return keyOf(out);
      }),
    invoke: (self, method, args) =>
      scoped(() => {
        const out = alloc(VALUE);
        const diag = diagnostic();
        check(
          abi._tn_invoke(
            handleOf(self),
            string(method).pointer,
            values(args),
            args.length,
            out,
            diag,
          ),
          diag,
          `${method}()`,
        );
        return readValue(out);
      }),
    get: (self, path) =>
      scoped(() => {
        const out = alloc(VALUE);
        const diag = diagnostic();
        check(abi._tn_get(handleOf(self), string(path).pointer, out, diag), diag, `get ${path}`);
        return readValue(out);
      }),
    set: (self, path, value) =>
      scoped(() => {
        const pointer = values([value]);
        const diag = diagnostic();
        check(
          abi._tn_set(handleOf(self), string(path).pointer, pointer, diag),
          diag,
          `set ${path}`,
        );
      }),
    release: (self) =>
      scoped(() => {
        const diag = diagnostic();
        abi._tn_object_release(handleOf(self), diag);
        abi._tn_diagnostic_release(diag);
      }),
    setCallback: (self, name, handler) =>
      scoped(() => {
        const diag = diagnostic();
        if (handler === null) {
          check(
            abi._tn_set_callback(handleOf(self), string(name).pointer, 0, 0, 0, diag),
            diag,
            `clear ${name}`,
          );
          return;
        }
        trampolines();
        const id = nextHandler++;
        handlers.set(id, handler);
        const status = abi._tn_set_callback(
          handleOf(self),
          string(name).pointer,
          invokeTrampoline,
          id,
          releaseTrampoline,
          diag,
        );
        if (status !== 0) handlers.delete(id); // a refused pair was never taken
        check(status, diag, `set ${name}`);
      }),
  };
}
