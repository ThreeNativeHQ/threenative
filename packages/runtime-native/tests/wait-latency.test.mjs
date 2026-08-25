import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

test('converted wait sites have no fixed sleep poll and retain a wake primitive', () => {
  const sites = [
    ['src/cli/main.cpp', /queueCondition\.wait\(/u],
    ['src/cli/lightmap.cpp', /runtime->run\(\)/u],
    ['src/webgpu/context.cpp', /waitCondition\.wait_for\(/u],
    ['src/webgpu/bindings.cpp', /waitCondition\.wait_for\(/u],
    ['src/video/gpu_readback_recorder.cpp', /frameCondition_\.wait\(/u],
    ['src/video/windows_graphics_capture_impl.cpp', /frameCondition_\.wait\(/u],
  ];

  for (const [path, waitPattern] of sites) {
    const source = read(path);
    assert.doesNotMatch(source, /sleep_for\(std::chrono::milliseconds\((?:1|10)\)\)/u, `${path} still has a fixed poll sleep`);
    assert.match(source, waitPattern, `${path} has no wait/fence replacement`);
  }
});

test('retained delays document why polling cannot yet become a condition wait', () => {
  const cli = read('src/cli/main.cpp');
  assert.match(cli, /audio callback threads[\s\S]*sleep_for\(std::chrono::milliseconds\(50\)\)/u);
  assert.match(read('src/runtime.cpp'), /Android lifecycle[\s\S]*SDL_Delay\(100\)/u);
  assert.match(read('src/video/screen_capture_kit.mm'), /Retry finding the window[\s\S]*usleep\(100000\)/u);
});
