/*
 * stb_vorbis implementation, in its own C translation unit.
 *
 * `stb_vorbis.c` is a single-file library like stb_image and cgltf, and like `stb_impl.cpp` it is
 * compiled exactly once so the symbols land in one object file. It stays C rather than joining
 * `stb_impl.cpp`: stb_vorbis is written for a C compiler, and the pull-data API this uses is the
 * whole of what `decodeAudioFile` needs.
 *
 * `STB_VORBIS_NO_STDIO` drops the file-opening half. The runtime never hands the decoder a path —
 * `decodeAudioData` receives an ArrayBuffer, from the VFS on device and from `fetch` on the web —
 * so the disk API is surface with no caller, and on Android it is surface that cannot work.
 */

#define STB_VORBIS_NO_STDIO 1
#define STB_VORBIS_NO_PUSHDATA_API 1

#include "stb_vorbis.c"
