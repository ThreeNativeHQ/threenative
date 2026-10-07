export const PERRY_NUMERIC_OPERATIONS: Record<string, number> = {
  math_sin: 1,
  math_cos: 2,
  array_new: 3,
  array_push: 4,
  array_length: 5,
  string_len: 5,
  object_get_dynamic: 6,
  object_set_dynamic: 7,
  object_get: 8,
  array_get: 6,
  array_set: 7,
  js_add: 9,
  length: 10,
  is_truthy: 11,
  js_strict_eq: 12,
};

// Perry's numeric runtime is linked into the compiled game's linear memory. The engine
// keeps its own allocator; a second imported memory holds the engine's packed output.
export function importPerryMemory(
  bytes: Uint8Array,
  memoryModule = "env",
): Uint8Array<ArrayBuffer> {
  const leb = (value: number): number[] => {
    const result: number[] = [];
    let remaining = value;
    do {
      const low = remaining & 127;
      remaining >>>= 7;
      result.push(low | (remaining ? 128 : 0));
    } while (remaining);
    return result;
  };
  let offset = 8;
  const read = () => {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = bytes[offset++] as number;
      if (offset > bytes.length || shift > 28) throw new Error("TN_WEB_BENCH_PERRY_MEMORY_LEB");
      value |= (byte & 127) << shift;
      shift += 7;
    } while (byte & 128);
    return value >>> 0;
  };
  const sections: { id: number; payload: number[] }[] = [];
  let memory: number[] | undefined;
  while (offset < bytes.length) {
    const id = bytes[offset++] as number;
    const length = read();
    const end = offset + length;
    if (end > bytes.length) throw new Error("TN_WEB_BENCH_PERRY_MEMORY_SECTION");
    if (id === 5) {
      if (memory || read() !== 1) throw new Error("TN_WEB_BENCH_PERRY_MEMORY_COUNT");
      memory = Array.from(bytes.subarray(offset, end));
    } else sections.push({ id, payload: Array.from(bytes.subarray(offset, end)) });
    offset = end;
  }
  const imports = sections.find((section) => section.id === 2);
  if (!memory || !imports) throw new Error("TN_WEB_BENCH_PERRY_MEMORY_MISSING");
  // The pinned compiler reserves two pages for its data and scratch stack. The
  // numeric runtime starts above them; reject a changed layout before rebinding.
  if (memory.length !== 2 || memory[0] !== 0 || memory[1] !== 2)
    throw new Error("TN_WEB_BENCH_PERRY_MEMORY_LAYOUT");
  // Preserve every existing function index; the appended import is the sole memory.
  const name = Array.from(new TextEncoder().encode(memoryModule));
  const entry = [...leb(name.length), ...name, 6, 109, 101, 109, 111, 114, 121, 2, ...memory];
  let count = 0;
  let shift = 0;
  let start = 0;
  do {
    const byte = imports.payload[start++] as number;
    count |= (byte & 127) << shift;
    shift += 7;
  } while ((imports.payload[start - 1] as number) & 128);
  imports.payload = [...leb(count + 1), ...imports.payload.slice(start), ...entry];
  const output = Array.from(bytes.subarray(0, 8));
  for (const section of sections) {
    output.push(section.id, ...leb(section.payload.length));
    for (const byte of section.payload) output.push(byte);
  }
  const result = new Uint8Array(output);
  if (!WebAssembly.validate(result)) throw new Error("TN_WEB_BENCH_PERRY_MEMORY_INVALID");
  return result;
}

export function packedPerryLoader(source: string) {
  const runtime = source.slice(0, source.indexOf("export async function loadPerry"));
  if (!runtime.includes("function bootPerryWasm"))
    throw new Error("TN_WEB_BENCH_PERRY_RUNTIME_MISSING");
  // The trusted compiler artifact owns the NaN-box/closure ABI. Retain its cold-path
  // dispatch; linked numeric operations stay in Wasm and can inline into the game.
  return new Function(`${runtime}\nreturn async function(bytes, inputs, submit, output) {
    let callback;
    const cold = buildImports().rt;
    const size = 6 + inputs.length / 3 * 5;
    if (!Number.isInteger(size) || size < 11 || size > 327686 ||
        !Number.isSafeInteger(output.byteOffset) || output.byteOffset < 0 || output.byteOffset % 8 ||
        output.byteOffset + size * 8 > output.memory.buffer.byteLength)
      throw new Error('TN_WEB_BENCH_PERRY_PACKED_REGION');
    let native, inputHandle, outputHandle;
    const imports = wrapImportsForI64(buildImports());
    imports.host = { mem_call: cold.mem_call, mem_call_i32: cold.mem_call_i32 };
    imports.env = { emscripten_notify_memory_growth: () => {} };
    imports.engine = { memory: output.memory };
    imports.wasi_snapshot_preview1 = { proc_exit: code => { throw new Error('TN_WEB_BENCH_PERRY_RUNTIME_EXIT: ' + code); } };
    const wrapped = imports.rt;
    const operations = ${JSON.stringify(PERRY_NUMERIC_OPERATIONS)};
    imports.rt = new Proxy(wrapped, { get: (target, name) => {
      if (name === 'string_new') return (offset, length) => {
        cold.string_new(offset, length);
        const id = stringTable.length - 1, operation = operations[stringTable[id]];
        if (operation) native.tn_runtime_name(id, operation);
      };
      return target[name];
    } });
    imports.ffi = {
      tn_inputs: () => { native.tn_numeric_arrays(); return inputHandle; },
      tn_values: () => outputHandle,
      tn_submit: handle => {
        const size = native.tn_array_size(handle);
        if (size !== 6 + inputs.length / 3 * 5) throw new Error('TN_WEB_BENCH_PERRY_PACKED_SIZE: ' + size);
        if (handle !== outputHandle || native.tn_array_data(handle) !== output.byteOffset) throw new Error('TN_WEB_BENCH_PERRY_PACKED_ADDRESS');
        if (!outputView || outputView.buffer !== output.memory.buffer)
          outputView = new Float64Array(output.memory.buffer, output.byteOffset, size);
        submit(outputView);
      },
      tn_ready: value => { callback = __bitsToJsValue(value); },
    };
    let outputView;
    const { instance } = await WebAssembly.instantiate(bytes, imports);
    native = instance.exports;
    if (native._initialize) native._initialize();
    inputHandle = native.tn_array_create(inputs.length);
    outputHandle = native.tn_array_external(size, output.byteOffset);
    new Float64Array(native.memory.buffer, native.tn_array_data(inputHandle), inputs.length).set(inputs);
    wasmInstance = instance;
    wasmMemory = native.memory;
    instance.exports._start();
    if (!callback || callback.funcIdx === undefined) throw new Error('TN_WEB_BENCH_PERRY_CLOSURE');
    const fn = instance.exports.__indirect_function_table.get(callback.funcIdx | 0);
    if (typeof fn !== 'function') throw new Error('TN_WEB_BENCH_PERRY_TABLE');
    const update = frame => fn(...callback.captures, __jsValueToBits(frame));
    update.allocations = () => native.tn_array_allocations();
    return update;
  };`)() as (
    bytes: Uint8Array,
    inputs: number[],
    submit: (values: Float64Array) => void,
    output: { memory: WebAssembly.Memory; byteOffset: number },
  ) => Promise<((frame: number) => void) & { allocations(): number }>;
}

export async function loadPackedPerry(
  inputs: number[],
  submit: (values: Float64Array) => void,
  output: { memory: WebAssembly.Memory; byteOffset: number },
) {
  const fetchArtifact = async (name: string) => {
    const response = await fetch(`./${name}`);
    if (!response.ok) throw new Error(`TN_WEB_BENCH_PERRY_FETCH: ${name}: ${response.status}`);
    return response;
  };
  try {
    const [source, bytes] = await Promise.all([
      fetchArtifact("perry-game.js").then((response) => response.text()),
      fetchArtifact("perry-linked.wasm").then(
        async (response) => new Uint8Array(await response.arrayBuffer()),
      ),
    ]);
    return await packedPerryLoader(source)(bytes, inputs, submit, output);
  } catch (error) {
    throw new Error(`TN_WEB_BENCH_PERRY_LOAD: ${String(error)}`, { cause: error });
  }
}
