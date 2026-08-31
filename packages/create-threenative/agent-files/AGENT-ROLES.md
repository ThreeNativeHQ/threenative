# ThreeNative agent roles

`__PROJECT_NAME__` includes two optional, user-owned roles. They are plain files: use them when
they help, edit them when your workflow needs something different, or delete them. There is no
automatic builder-to-verifier chain and no provider is selected for you.

| Role | Canonical contract | Claude Code adapter | Codex skill |
| --- | --- | --- | --- |
| Builder | `.threenative/agents/builder.md` | `.claude/agents/threenative-builder.md` | `.agents/skills/threenative-builder/SKILL.md` |
| Verifier | `.threenative/agents/verifier.md` | `.claude/agents/threenative-verifier.md` | `.agents/skills/threenative-verifier/SKILL.md` |

Run commands from the project root. Claude Code selects its adapter explicitly:

```sh
claude --agent threenative-builder "Implement one bounded player-visible change and report evidence."
```

Codex discovers repository skills under `.agents/skills`; name it in the request:

```sh
codex exec "Use the threenative-builder skill for one bounded player-visible change and report evidence."
```

Use the matching verifier role after a builder result when an independent check is useful. Both
providers read the same canonical contract, so framework instructions stay in `AGENTS.md` and
role instructions stay in `.threenative/agents/`.
