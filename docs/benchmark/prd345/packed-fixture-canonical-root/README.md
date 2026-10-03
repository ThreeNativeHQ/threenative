# Packed fixture canonical root

The normal root suite with a durable symlinked TMPDIR failed two packed MetaHuman consumer identity assertions: Node resolves import.meta URLs to the physical package path, while the fixture expected the symlink spelling. The fixture now resolves its extracted package root with realpath; all existing relative-WASM identity, checksum, lazy-loading and ordering assertions remain unchanged. No runtime package source changed.

Retained root failure: root-fullgate.log.gz. After correction, the actual packed consumer suite passed all 7 tests with the same TMPDIR (metahuman-canonical-root-green.log.gz). Independent review passed. The full root suite has not yet passed; its unit phase was not reached in this failed run.
