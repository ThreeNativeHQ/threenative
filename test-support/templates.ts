import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Where the shipped kits live. Read from disk on every call so that adding a kit is adding a
 * directory: no suite in this repository keeps its own copy of the template list.
 */
export const TEMPLATE_ROOT = path.resolve("packages/create-threenative/templates");

/** Every shipped template, sorted, hidden directories excluded. */
export function allTemplates(root = TEMPLATE_ROOT): readonly string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

/**
 * Every template that ships `relativePath`.
 *
 * A suite that gates one shipped file — the durable scenario, the touch controls, the loading
 * appearance block — asks for the templates carrying it instead of naming them. A kit added
 * tomorrow is then covered the day it ships that file, and a kit that stops shipping it leaves
 * the suite by deleting bytes rather than by editing a list.
 *
 * Fails closed: a path no template ships is a stale gate, not an empty pass.
 */
export function templatesShipping(relativePath: string, root = TEMPLATE_ROOT): readonly string[] {
  const shipping = allTemplates(root).filter((template) =>
    existsSync(path.join(root, template, relativePath)),
  );
  if (shipping.length === 0)
    throw new Error(`TN_TEMPLATE_GATE_STALE: no template ships '${relativePath}'.`);
  return shipping;
}
