// The MCP servers a ThreeNative project always has. `@threenative/core` is a direct dependency of
// every generated game, so `./node_modules/@threenative/core/mcp/<file>` is a path that resolves
// under npm, pnpm and yarn alike — unlike `./node_modules/threenative-asset-mcp/...`, which only
// exists when the package manager hoists, and which a project that never listed the server as a
// direct dependency does not have at all.
export const MCP_SERVERS = Object.freeze({
  "threenative-assets": Object.freeze({
    command: "node",
    args: Object.freeze(["./node_modules/@threenative/core/mcp/assets.mjs"]),
    // Entries rather than an object literal: these are environment variable names, not identifiers,
    // and written as property names they read as names the naming rule must judge.
    env: Object.freeze(
      Object.fromEntries([
        ["ASSET_DOWNLOAD_DIR", "./public/assets"],
        ["AUDIO_DOWNLOAD_DIR", "./public/audio"],
      ]),
    ),
  }),
  "threenative-sculpt": Object.freeze({
    command: "node",
    args: Object.freeze(["./node_modules/@threenative/core/mcp/sculpt.mjs"]),
  }),
  "threenative-engine": Object.freeze({
    command: "node",
    args: Object.freeze(["./node_modules/@threenative/core/mcp/engine.mjs"]),
  }),
});

/** The external package each shim launches. Core installs asset and sculpt transitively and bundles
 * engine discovery itself: a game author must never know these package names or install them
 * separately. The pinned engine version remains an emergency fallback for a legacy development
 * checkout whose bundle has not been built. */
export const MCP_PACKAGES = Object.freeze({
  assets: Object.freeze({ name: "threenative-asset-mcp", version: "0.4.0" }),
  sculpt: Object.freeze({ name: "threenative-sculpt-mcp", version: "0.1.0" }),
  engine: Object.freeze({ name: "threenative-engine-mcp", version: "0.2.0" }),
});

/** Adds the ThreeNative servers to an existing config without touching anything else in it, and
 * reports whether the file needs rewriting. Fails closed on a config that is not an object: an
 * unreadable `.mcp.json` is the user's, and overwriting it would lose servers we did not write. */
export function mergeMcpServers(existing) {
  const malformed =
    existing !== undefined &&
    (typeof existing !== "object" || existing === null || Array.isArray(existing));
  if (malformed) {
    throw new Error("MCP config root must be an object.");
  }
  const previous = existing ?? {};
  const servers = { ...(previous.mcpServers ?? {}) };
  let changed = false;
  for (const [name, server] of Object.entries(MCP_SERVERS)) {
    const wanted = JSON.parse(JSON.stringify(server));
    if (JSON.stringify(servers[name]) === JSON.stringify(wanted)) continue;
    servers[name] = wanted;
    changed = true;
  }
  return { changed, config: { ...previous, mcpServers: servers } };
}
