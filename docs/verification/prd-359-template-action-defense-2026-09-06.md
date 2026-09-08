# PRD-359 template instructions — action-rpg and defense — 2026-09-06

This records the first template-instruction pair. The shared regression intentionally remains
red until the remaining three pairs are updated; this pair's source and mirror checks are green.

## Caller and source

- `packages/create-threenative/templates/action-rpg/AGENTS.md:98-114` and
  `packages/create-threenative/templates/defense/AGENTS.md:91-107` document the optional
  `@threenative/core/net` transport, Go reference server, limits, delivery semantics and
  unsupported behavior.
- `packages/create-threenative/templates/action-rpg/CLAUDE.md` and
  `packages/create-threenative/templates/defense/CLAUDE.md` are generated mirrors.
- `packages/create-threenative/__tests__/template.spec.ts:194-217` is the shared regression for all
  template instruction pairs.

## Red

Command:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t "optional multiplayer transport"
```

Exit `1`, `/tmp/prd359-red-template-networking.log`. Before this pair was authored, the test
reported `minimal/AGENTS.md missing @threenative/core/net`; no template had the required contract.

## Green for this pair

Commands:

```sh
pnpm sync:agents
pnpm sync:agents --check
```

Both exited `0`; sync reported 19 mirrors and 2 written, then the check confirmed all 19 mirrors
were in sync (`/tmp/prd359-green-template-action-defense-sync.log` and
`/tmp/prd359-green-template-action-defense-sync-check.log`). The all-template regression remains
expected to exit `1` while `minimal`, `platformer`, `puzzle`, `racing`, `runner`, `sailing`,
`shooter` and `starter` await their rows (`/tmp/prd359-template-action-defense-gate.log`).

The pair now states that transport is opt-in, offline play remains usable, reliable-ordered sends
are ordered and bounded, unreliable datagrams may drop, and unsupported WebTransport rejects with
`TN_NET_UNAVAILABLE` without a fallback.
