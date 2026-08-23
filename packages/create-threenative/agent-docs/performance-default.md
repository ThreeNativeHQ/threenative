## Performance default

Keep vector/array scratch outside `update` methods and refill it; avoid ordinary-frame allocation. Pool recurring bounded-lifetime objects. Write HUD state when values change.

Prove it with a bounded `performance` assertion:

```json
{ "performance": { "maxFrameMsP95": 33 } }
```

See [`agent-docs/references/assertion-reference.md#performance`](agent-docs/references/assertion-reference.md#performance) for fields.

Name deliberate allocation/look tradeoffs beside the code and keep measurement active; overrides change the choice, not the proof.
