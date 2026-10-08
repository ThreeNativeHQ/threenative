// PRD-540: the JS TSL corpus (tsl-corpus/corpus.js, the one tn-native-engine-tsl-js runs on V8) on
// the Wasm back end: browser-tsl.ts over the real ABI module, each graph lowered by the engine.
//   tsx tests/native-engine/wasm/tsl-corpus.ts <path to tn-native-engine-abi-module.js>
// Prints what tn-native-engine-tsl-js prints, for differential.mjs --suite tsl-ir --wasm.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";

import {
  TSL_NODE,
  type TnAbiModule,
  createWasmRuntime,
} from "../../../../three-native/src/browser-backend.js";
import { defineTsl } from "../../../../three-native/src/browser-tsl.js";

const modulePath = process.argv[2];
if (modulePath === undefined) throw new Error("usage: tsl-corpus.ts <abi module .js>");
const createTnAbi = createRequire(import.meta.url)(
  path.resolve(modulePath),
) as () => Promise<TnAbiModule>;
const abi = await createTnAbi();
// The dump hook needs the context the runtime creates; read it as tn_context_create writes it.
let context = 0;
const create = abi._tn_context_create;
abi._tn_context_create = (out, version, diag) => {
  const status = create(out, version, diag);
  context = new DataView(abi.HEAPU8.buffer).getUint32(out, true);
  return status;
};
const runtime = createWasmRuntime(abi);
if (runtime.tsl === undefined) throw new Error("TN_TSL_CORPUS: the ABI module carries no TSL");
const source = readFileSync(
  path.join(import.meta.dirname, "..", "tsl-corpus", "corpus.js"),
  "utf8",
);
const rows = runInNewContext(source, { tsl: defineTsl(runtime.tsl).exports }) as [
  string,
  string,
  Record<symbol, number>,
][];
if (!Array.isArray(rows) || rows.length !== 32)
  throw new Error("TN_TSL_CORPUS: corpus must return 32 graphs");
const { _tnw_tsl_dump: dump } = abi as unknown as {
  _tnw_tsl_dump(context: number, node: bigint, stage: number): number;
};
for (const [name, stage, graph] of rows) {
  const text = (() => {
    const label = abi._malloc(stage.length + 1);
    abi.stringToUTF8(stage, label, stage.length + 1);
    const pointer = dump(context, BigInt(graph[TSL_NODE] as number), label);
    abi._free(label);
    const out = abi.UTF8ToString(pointer);
    abi._free(pointer);
    return out;
  })();
  process.stdout.write(`# ${name}\n${text}`);
}
