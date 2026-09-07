# PRD-359 task 4c-contract evidence

Status: accepted. This bounded follow-on owns the sixth file that the decoder
repair needed: the reviewed runtime bootstrap hash contract.

## Red first

Before changing `packages/runtime-native/tests/runtime-next-contract.test.mjs`,
the existing contract rejected the changed fetch source:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/runtime-next-contract.test.mjs
FAIL  tests/runtime-next-contract.test.mjs > runtime JavaScript is byte-stable, embedded, and loaded by the bootstrap
AssertionError: fetch-polyfill.js was changed without updating its contract
Expected: "0b9f8553897fa012e5eb2a754f9f36e3178d8a1bc1de4645dbeac0a2545a45e5"
Received: "534120ac25207a5b95b874b0e1800a902c9efbfb1845c6aab9a40b449cc8455b"
Tests  1 failed | 35 passed | 2 skipped (38)
EXIT_CODE=1
```

## Repair

The contract now records the reviewed source bytes:

| Runtime script | SHA-256 |
| --- | --- |
| `fetch-polyfill.js` | `534120ac25207a5b95b874b0e1800a902c9efbfb1845c6aab9a40b449cc8455b` |
| `streams-polyfill.js` | `b57569ac2079bc5864eb7c8aefef6b03321acad8b6f6364b3de714e2bee64d83` |

The contract remains literal and still checks embedding and bootstrap consumers;
no runtime source or loader was changed in this row.

## Green

The focused decoder and contract suites pass together:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/fetch-shim.test.mjs tests/streams-shim.test.mjs tests/runtime-next-contract.test.mjs
Test Files  3 passed (3)
Tests  73 passed | 2 skipped (75)
exit 0
```

The actual contract caller is `packages/runtime-native/tests/runtime-next-contract.test.mjs:72-75`;
the generated-script embed step remains covered by the same test. This row only
updates the hash gate after the 4c source/native review.
