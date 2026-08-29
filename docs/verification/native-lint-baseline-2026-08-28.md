# Native lint baseline — 2026-08-28

Configuration: `TN_ENABLE_CLANG_TIDY=ON`, using LLVM clang-tidy 22.1.8 against
`build/tn-linux-tidy/compile_commands.json`. The shipping build keeps the option off.

## Existing advisory findings

The complete compiled `packages/runtime-native/src` scan passed with 854 inherited diagnostics and
zero blocking diagnostics.

| Check | Count |
| --- | ---: |
| `bugprone-branch-clone` | 6 |
| `bugprone-command-processor` | 5 |
| `bugprone-easily-swappable-parameters` | 67 |
| `bugprone-implicit-widening-of-multiplication-result` | 21 |
| `bugprone-invalid-enum-default-initialization` | 25 |
| `bugprone-narrowing-conversions` | 53 |
| `bugprone-nondeterministic-pointer-iteration-order` | 5 |
| `bugprone-switch-missing-default-case` | 3 |
| `bugprone-throwing-static-initialization` | 6 |
| `bugprone-unused-return-value` | 1 |
| `cppcoreguidelines-pro-type-member-init` | 24 |
| `performance-avoid-endl` | 525 |
| `performance-enum-size` | 72 |
| `performance-inefficient-string-concatenation` | 2 |
| `performance-inefficient-vector-operation` | 1 |
| `performance-move-const-arg` | 1 |
| `performance-no-int-to-ptr` | 2 |
| `performance-unnecessary-value-param` | 34 |
| Compiler/library diagnostic | 1 |

The naming baseline contains only five exact legacy or external declarations:
`SDL_TouchFingerEvent`, `curl_slist`, `clock`, `socket_t`, and `steady`. Any other class, struct,
enum, or alias that violates the CamelCase rules is blocking.

## Red-green evidence

Before configuration existed, `native-lint-config.test.mjs` failed opening `.clang-tidy`. After the
configuration and quality-gate wiring landed, the focused test passed and `pnpm quality` no longer
reported `packages/runtime-native/src:1 lint-coverage-hole`.

The removal control temporarily moved `.clang-tidy` out of the package. Quality is intentionally a
report-only command and therefore exited zero, but restored the exact finding; the focused gate
then failed non-zero because the configuration was absent:

```text
inherited packages/runtime-native/src:1 lint-coverage-hole value=ignored threshold=linted
QUALITY_EXIT=0 TEST_EXIT=1
```

The complete opt-in build passed:

```text
TIDY_DIAGNOSTICS=854
BLOCKING_DIAGNOSTICS=0
```

Two disposable negative controls failed closed. A moved-from `std::string` produced
`bugprone-use-after-move`; an invalid struct name produced `readability-identifier-naming`:

```text
error: 'source' used after it was moved [bugprone-use-after-move,-warnings-as-errors]
NEGATIVE_EXIT=1

error: invalid case style for struct 'invalid_native_type'
[readability-identifier-naming,-warnings-as-errors]
NAMING_NEGATIVE_EXIT=1
```

## Phase 4 negative control — observed 2026-08-29

PRD-229 Phase 4 requires a manual control: *a new `bugprone` violation fails the build*. It was
never recorded when the phase landed. Run now against the committed `.clang-tidy`, whose
`WarningsAsErrors` lists `bugprone-use-after-move`.

A file using a moved-from `std::string`:

```text
prd229-tidy-negative.cpp:8:29: error: 'source' used after it was moved
    [bugprone-use-after-move,-warnings-as-errors]
1 warning treated as error
```

The same file with the use-after-move removed, and nothing else changed:

```text
16 warnings generated.
Suppressed 16 warnings (16 in non-user code).
exit 0
```

One variable, two results: the check is live and it is an error, not a warning. The build wiring
that carries it — `CMAKE_CXX_CLANG_TIDY` behind `TN_ENABLE_CLANG_TIDY` — is separately asserted by
`tests/native-lint-config.test.mjs`, whose own control is deleting `.clang-tidy` and watching the
`lint-coverage-hole` finding return to `pnpm quality`.
