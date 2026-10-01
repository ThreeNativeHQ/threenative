import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Lets the shipped loader, which reads its payload with `fetch` alone, run under Node.
 *
 * Node's `fetch` refuses `file:` URLs; a browser and the native host answer them. Only `file:`
 * is served here — every other URL goes to the real `fetch` untouched.
 */
const networkFetch = globalThis.fetch;
globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("file:")) return await networkFetch(input, init);
  try {
    return new Response(await readFile(fileURLToPath(url)));
  } catch {
    return new Response(null, { status: 404 });
  }
};
