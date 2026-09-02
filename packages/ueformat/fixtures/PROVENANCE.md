# Fixture provenance

All three `.uemodel` fixtures are **synthetic**, authored for this repository with
`__tests__/fixture-builder.ts` (a hand-rolled UEFormat v10 writer). No bytes derive from any
marketplace pack, game, or licensed source, so all three carry this repository's MIT licence.

| Fixture | Bytes | Covers |
| --- | --- | --- |
| `sample-table.uemodel` | 491 | uncompressed body; table mesh, one material |
| `sample-table-gzip.uemodel` | 300 | GZIP-compressed body, same mesh — the decompression path |
| `sample-rigged-gzip.uemodel` | 508 | GZIP body; skeleton, skin weights, morph targets, collision |

Total: ~1.3 KB. Regenerating them is possible with the builder but is not wired into the specs —
the committed bytes are the pinned subject, exactly as `SM_cube.uasset` is for `raw-unreal`
(see that package's own `fixtures/PROVENANCE.md`).
