# PRD-151 shared template agent docs verification

Date: 2026-08-18

The synchronizer now expands five shared fragments into every template's `AGENTS.md`, mirrors
the expanded document to `CLAUDE.md`, and removes repository-only marker comments when a project
is scaffolded.

## 1. Expand the shared regions

Command:

```text
pnpm sync:agents
```

Output:

```text
agent docs synced: 15 mirrors, 13 written
```

The four thin templates gained the expanded sections:

```text
git diff --stat -- packages/create-threenative/templates/action-rpg packages/create-threenative/templates/defense packages/create-threenative/templates/racing packages/create-threenative/templates/shooter
 .../templates/action-rpg/AGENTS.md                 | 242 ++++++++++++++++++++
 .../templates/action-rpg/CLAUDE.md                 | 242 ++++++++++++++++++++
 .../create-threenative/templates/defense/AGENTS.md | 242 ++++++++++++++++++++
 .../create-threenative/templates/defense/CLAUDE.md | 242 ++++++++++++++++++++
 .../templates/racing/AGENTS.md                     | 242 ++++++++++++++++++++
 .../templates/racing/CLAUDE.md                     | 242 ++++++++++++++++++++
 .../templates/shooter/AGENTS.md                    | 242 ++++++++++++++++++++
 .../templates/shooter/CLAUDE.md                    | 242 ++++++++++++++++++++
 8 files changed, 1888 insertions(+), 48 deletions(-)
```

## 2. Synced-tree check

Command:

```text
pnpm sync:agents --check
```

Output:

```text
agent docs in sync: 15 CLAUDE.md mirrors
```

Exit code: `0`.

## 3. Hand-edit negative control

I temporarily added `[hand edit]` inside the `framework-blocks-you` region in
`packages/create-threenative/templates/action-rpg/AGENTS.md`, then ran the check.

```text
agent docs out of sync with shared fragments or AGENTS.md:
  packages/create-threenative/templates/action-rpg/AGENTS.md
Run: pnpm sync:agents
ELIFECYCLE Command failed with exit code 1.
EXIT_CODE=1
```

The temporary edit was restored.

## 4. Required-set negative control

I temporarily deleted the `ctx-surface` marker from the defense template and ran:

```text
pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t "should require every shared agent fragment in every template"
```

The required-set spec failed with:

```text
AssertionError: defense/ctx-surface: expected ... to contain '<!-- shared: ctx-surface -->'
Tests 1 failed | 23 skipped
EXIT_CODE=1
```

The temporary marker deletion was restored.

## 5. Unknown-fragment negative control

I temporarily changed the racing template's `sculpt-loop` marker to `missing-fragment` and ran
`pnpm sync:agents`.

```text
Unknown shared fragment 'missing-fragment' in packages/create-threenative/templates/racing/AGENTS.md.
EXIT_CODE=1
```

The temporary marker change was restored.

## 6. Full test gate

Command:

```text
pnpm test
```

Final output:

```text
Test Files  146 passed (146)
Tests       1365 passed (1365)
suite temporary directory count unchanged: 85
EXIT_CODE=0
```

## 7. Scaffolded-document gate

The focused contract suite scaffolds every discovered template and checks both generated agent
documents for marker comments:

```text
pnpm exec vitest run scripts/__tests__/sync-agent-docs.spec.ts packages/create-threenative/__tests__/template.spec.ts

Test Files  2 passed (2)
Tests       31 passed (31)
EXIT_CODE=0
```

The scaffold test iterated all seven template directories. Generated `AGENTS.md` and `CLAUDE.md`
files contained no `<!-- shared: ... -->` or `<!-- /shared -->` comments.

## Additional gates

```text
pnpm typecheck  # EXIT_CODE=0
pnpm lint       # EXIT_CODE=0; 223 existing cognitive-complexity warnings
git diff --check  # EXIT_CODE=0
```
