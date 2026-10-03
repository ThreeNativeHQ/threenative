# Durable suite temporary parent

The full verification script now honors explicit `TMPDIR` with the existing `/tmp` default.
Actual allocation/cleanup regression was RED when the script ignored the requested parent.
A second RED exposed continued execution after failed allocation under `set -u` without `-e`.
Directory allocation now fails closed; marker allocation failure removes only its own newly
created empty directory and preserves the failure status. No checks, phase ordering, filters,
permissions or successful cleanup behavior changed.

Three focused/CI partition specs pass 142 tests. Behavioral tests use a space-bearing parent,
verify exported temporary location and unrelated sentinel preservation, and cover directory
and marker failures. Shell syntax and formatting pass. Independent source review reports no
remaining finding. These are harness tests, not a completed full-root gate.
