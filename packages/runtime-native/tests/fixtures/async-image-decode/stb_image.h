#pragma once

// A deterministic codec boundary for the scheduling/lifetime contract. The test links the real
// async_image_decode.cpp; this is not evidence about PNG/WebP correctness or GPU presentation.
unsigned char* stbi_load_from_memory(const unsigned char*, int, int*, int*, int*, int);
void stbi_image_free(void*);
const char* stbi_failure_reason();
