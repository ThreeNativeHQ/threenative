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
