# threenative-engine-mcp

An offline MCP server that lets a ThreeNative authoring agent search the committed engine
capability manifest by situation and inspect one capability in detail.

The server exposes exactly two read-only tools: `engine_search_capabilities` and
`engine_capability_detail`.

First infer the concrete mechanics implied by the request. Call `engine_search_capabilities` once
with that mechanically explicit request and `scope: "request"`, then once per mechanic with
`scope: "mechanic"`. Complete requests return up to 15 deduplicated capabilities; focused
situations return up to five. A genre label alone returns no guessed recipe. Every result includes
`matchedSituation`, so an authoring agent can verify why it was selected instead of treating a
lexical coincidence as engine guidance.

## Which manifest the server reads

The first that exists wins, so the manifest can never drift from the engine the project runs:

1. `THREENATIVE_CAPABILITIES_MANIFEST` — an explicit override, resolved against the working
   directory.
2. `node_modules/@threenative/core/capabilities.json` — found by walking up from the working
   directory. The installed package ships the manifest its own build generated, so it always
   describes the engine the project actually links; it moves exactly when the dependency does.
3. `packages/core/capabilities.json` — found by walking up from the running server file, which
   answers from the engine repository's own generated manifest when the server is launched from
   the repository rather than from an installed package.
4. `capabilities.json` in the working directory — the original default, kept for a bare checkout
   with a committed copy and no installed engine package.

A project copy committed at scaffold time is therefore inert whenever the package is installed:
the two never need re-syncing by hand.

