Before writing anything engine-shaped, look the capability up. Two routes, and the second
needs no MCP server:

1. Ask the MCP: `engine_search_capabilities("pool decals on surfaces")` — plain situations work.
2. Read the generated index:
   `packages/create-threenative/agent-docs/references/capability-reference.md`.

`ctx` conveniences (`ctx.raycast`, `ctx.random`, `ctx.tween`, …) are **properties on `ctx`,
never imports** — grepping imports will never surface them; the ctx table in this document
covers them. Writing a superseded raw construct (`new Raycaster(`, `Math.random(`, …) fails
`pnpm budgets`; when the raw construct is genuinely right, annotate that exact line
`// engine-override: <reason>`.
