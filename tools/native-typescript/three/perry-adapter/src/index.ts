// The TypeScript surface of the Perry adapter (decision 11). Every declaration below is one
// `js_*` symbol the adapter's package.json declares to Perry's native-library mechanism, so the
// facade reaches the engine C ABI through the adapter and never through a compiler-specific
// intrinsic. The engine side of that boundary knows nothing of Perry.
declare function js_tn_init(): number;
declare function js_tn_arg_number(value: number): void;
declare function js_tn_arg_object(object: number): void;
declare function js_tn_construct(className: string): number;
declare function js_tn_invoke(object: number, method: string): number;
declare function js_tn_get(object: number, path: string): number;
declare function js_tn_set_number(object: number, path: string, value: number): number;
declare function js_tn_result_number(): number;
declare function js_tn_result_object(): number;
declare function js_tn_result_string(): string;
declare function js_tn_set_callback(object: number, name: string, closure: number): number;
declare function js_tn_safe_point(): void;
declare function js_tn_held(object: number): number;
declare function js_tn_live(): number;
declare function js_tn_resident_kb(): number;
declare function js_tn_fire_before_render(object: number): string;
declare function js_tn_callback_error(message: string): void;
declare function js_tn_collect(): void;
declare function js_tn_release(object: number): void;

/** One engine object, as game code names it: an ordinary number, and 0 for no object. */
export type TnObject = number;

/** Opens the engine context for this process. Idempotent. */
export function init(): number {
  return js_tn_init();
}

/** Stages one argument: a number, or an engine object. */
export function argNumber(value: number): void {
  js_tn_arg_number(value);
}

export function argObject(object: TnObject): void {
  js_tn_arg_object(object);
}

/** Constructs an engine object by catalog name, or `null` when the catalog refuses it. */
export function construct(className: string): TnObject {
  return js_tn_construct(className);
}

export function invoke(self: TnObject, method: string): number {
  return js_tn_invoke(self, method);
}

export function get(self: TnObject, path: string): number {
  return js_tn_get(self, path);
}

export function setNumber(self: TnObject, path: string, value: number): number {
  return js_tn_set_number(self, path, value);
}

export function resultNumber(): number {
  return js_tn_result_number();
}

/** The engine object the last call returned, or `null`. The same object always answers the same. */
export function resultObject(): TnObject {
  return js_tn_result_object();
}

export function resultString(): string {
  return js_tn_result_string();
}

/** Attaches (or with `undefined`, detaches) the closure the engine runs for `name`. */
export function setCallback(self: TnObject, name: string, closure: unknown): number {
  return js_tn_set_callback(self, name, closure === undefined ? 0 : (closure as number));
}

/** Holds attached callback-bearing objects, lets detached ones go: the host's between-frames point. */
export function safePoint(): void {
  js_tn_safe_point();
}

/** Whether the safe point currently holds this object: an attached callback-bearing object. */
export function held(object: TnObject): number {
  return js_tn_held(object);
}

/** Engine objects this program currently holds. */
export function live(): number {
  return js_tn_live();
}

/** The process's resident set in KiB (Linux); -1 when unreadable. */
export function residentKb(): number {
  return js_tn_resident_kb();
}

/** Runs an object's callback through the engine, as its renderer does before a draw. */
export function runBeforeRender(object: TnObject): string {
  return js_tn_fire_before_render(object);
}

/** Records the message of a callback throw, so the engine reports a diagnostic instead of crashing. */
export function callbackError(message: string): void {
  js_tn_callback_error(message);
}

/**
 * Releases an engine object now. The facade calls this when the program drops its wrapper, which is
 * what makes the engine's object count fall with the program's own references.
 */
export function release(object: TnObject): void {
  if (object === null || object === undefined) return;
  js_tn_release(object);
}

/**
 * The collection point: the facade has already released the engine objects nothing holds, so Perry
 * only has to reclaim the wrappers, closures and cycles it now sees as garbage. It must do that
 * itself, through its automatic generational collector, because Perry's explicit `gc()` is a
 * non-moving full mark-sweep: it reclaims dead blocks but never compacts, so resident memory grows
 * with each call. The copying minor compacts, so this point deliberately does not force `gc()`.
 */
export function collect(): void {
  js_tn_collect();
}

declare function js_tn_tsl_build(
  op: string,
  a: number,
  b: number,
  c: number,
  value: number,
): number;
declare function js_tn_tsl_error(): string;
declare function js_tn_tsl_set(material: number, node: number): number;
declare function js_tn_tsl_compile(material: number): number;
declare function js_tn_tsl_release(node: number): void;
declare function js_tn_render(scene: number, camera: number): string;
declare function js_tn_bench(op: string, a: number, b: number, c: number, d: number): string;
declare function js_tn_bench_config(name: string): number;
export function tslBuild(op: string, a: number, b: number, c: number, value: number): number {
  return js_tn_tsl_build(op, a, b, c, value);
}
export function tslError(): string {
  return js_tn_tsl_error();
}
export function tslSet(material: number, node: number): number {
  return js_tn_tsl_set(material, node);
}
export function tslCompile(material: number): number {
  return js_tn_tsl_compile(material);
}
export function tslRelease(node: number): void {
  js_tn_tsl_release(node);
}
export function render(scene: number, camera: number): string {
  return js_tn_render(scene, camera);
}
/** The benchmark session (PRD-533): open, begin, render, finish. Empty on success. */
export function bench(op: string, a: number, b: number, c: number, d: number): string {
  return js_tn_bench(op, a, b, c, d);
}
/** A benchmark setting from the environment, or -1 when it is unknown. */
export function benchConfig(name: string): number {
  return js_tn_bench_config(name);
}
