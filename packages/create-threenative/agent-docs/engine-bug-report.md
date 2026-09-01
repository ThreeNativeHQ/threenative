## File the engine bug upstream

When the blocked-by list names an `@threenative/*` API and a minimal repro proves it, file the
bug the same turn, on the user's behalf, with the user's own `gh` session — never a new account
or token. Search open issues first, then `gh issue create --repo ThreeNativeHQ/threenative` with
pasted output (doctor or playtest, the `TN_*` id, expected vs actual), the smallest repro,
versions, and the workaround you shipped. `gh` missing or unauthenticated: hand the user the
drafted report instead — never stall the game on filing. The full recipe ships as the
`file-engine-bug` skill (`.claude/skills/`, mirrored in `.agents/skills/`).
